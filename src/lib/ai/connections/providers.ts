export const PROVIDERS = [
  { kind: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', needsKey: true, tab: 'cloud', icon: 'openrouter', keyPlaceholder: 'sk-or-...' },
  { kind: 'nanogpt', label: 'NanoGPT', url: 'https://api.nano-gpt.com/api/v1', needsKey: true, tab: 'cloud', icon: 'cloud' },
  { kind: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com/v1', needsKey: true, tab: 'cloud', icon: 'cloud', keyPlaceholder: 'sk-ant-...' },
  { kind: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true, tab: 'cloud', icon: 'cloud' },
  { kind: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', needsKey: true, tab: 'cloud', icon: 'openai', keyPlaceholder: 'sk-...' },
  { kind: 'xai', label: 'Grok', url: 'https://api.x.ai/v1', needsKey: true, tab: 'cloud', icon: 'grok', keyPlaceholder: 'xai-...' },
  { kind: 'lm_studio', label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', needsKey: false, tab: 'local', icon: 'desktop' },
  { kind: 'llama_cpp', label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', needsKey: false, tab: 'local', icon: 'terminal' },
  { kind: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434/v1', needsKey: false, tab: 'local', icon: 'ollama' },
  { kind: 'koboldcpp', label: 'KoboldCPP', url: 'http://127.0.0.1:5001/v1', needsKey: false, tab: 'local', icon: 'kobold' },
  { kind: 'generic_openai', label: 'Custom', url: '', needsKey: false, tab: 'cloud', icon: 'custom' },
] as const;

export type ProviderKind = typeof PROVIDERS[number]['kind'];
export interface ProviderDefinition {
  kind: ProviderKind;
  label: string;
  url: string;
  needsKey: boolean;
  tab: 'local' | 'cloud';
  icon: typeof PROVIDERS[number]['icon'];
  keyPlaceholder?: string;
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = Object.fromEntries(
  PROVIDERS.map(provider => [provider.kind, provider.kind === 'xai' ? 'xAI / Grok'
    : provider.kind === 'generic_openai' ? 'Generic OpenAI-compatible'
    : provider.kind === 'koboldcpp' ? 'KoboldCpp' : provider.label]),
) as Record<ProviderKind, string>;
