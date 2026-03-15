use once_cell::sync::Lazy;
use tokenizers::Tokenizer;

static MISTRAL_JSON: &str = include_str!("../tokenizers/mistral.json");
static LLAMA3_JSON:  &str = include_str!("../tokenizers/llama3.json");
static QWEN2_JSON:   &str = include_str!("../tokenizers/qwen2.json");

// Each tokenizer is parsed from JSON exactly once, on first use.
// Tokenizers that are never needed (wrong model family) are never parsed

static MISTRAL_TOKENIZER: Lazy<Option<Tokenizer>> =
    Lazy::new(|| Tokenizer::from_bytes(MISTRAL_JSON.as_bytes()).ok());
static LLAMA3_TOKENIZER: Lazy<Option<Tokenizer>> =
    Lazy::new(|| Tokenizer::from_bytes(LLAMA3_JSON.as_bytes()).ok());
static QWEN2_TOKENIZER: Lazy<Option<Tokenizer>> =
    Lazy::new(|| Tokenizer::from_bytes(QWEN2_JSON.as_bytes()).ok());


// Matches on lowercase substrings of the model name string.

fn detect_tokenizer_key(model_name: &str) -> &'static str {
    let m = model_name.to_lowercase();
    if m.contains("mistral") || m.contains("mixtral") || m.contains("dolphin") {
        "mistral"
    } else if m.contains("qwen") || m.contains("chatml") {
        "qwen2"
    } else {
        // Llama3 as general fallback — covers Llama 2/3, Gemma, and unknowns
        "llama3"
    }
}


// Used when a tokenizer failed to load or encoding returned an error.
// 3.35 bytes/token

fn fallback_count(text: &str) -> u32 {
    (text.len() as f32 / 3.35).ceil() as u32
}

/// Counts the tokens in `text` using the tokenizer that best matches `model_name`.
///
/// Called once per "Send" press — the async overhead is invisible next to
/// the AI generation that follows. Falls back to a byte-based heuristic if
/// the tokenizer failed to load or encoding returns an error.
#[tauri::command]
pub fn count_tokens(text: String, model_name: String) -> u32 {
    if text.is_empty() {
        return 0;
    }

    let tokenizer_opt = match detect_tokenizer_key(&model_name) {
        "mistral" => MISTRAL_TOKENIZER.as_ref(),
        "qwen2"   => QWEN2_TOKENIZER.as_ref(),
        _         => LLAMA3_TOKENIZER.as_ref(),
    };

    match tokenizer_opt {
        Some(tokenizer) => {
            match tokenizer.encode(text.as_str(), false) {
                Ok(encoding) => encoding.len() as u32,
                Err(e) => {
                    eprintln!("[Tokenizer] Encoding error: {}", e);
                    fallback_count(&text)
                }
            }
        }
        None => {
            eprintln!("[Tokenizer] Tokenizer failed to load — using fallback.");
            fallback_count(&text)
        }
    }
}