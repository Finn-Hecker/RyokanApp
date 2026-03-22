# Ryokan

> **Immersive, local-first AI Roleplay - built for atmosphere, not spreadsheets.**
> Powered by Rust, Tauri v2, and Svelte 5.

<p>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" />
  <img src="https://img.shields.io/badge/status-Alpha_v0.3-green.svg" />
  <img src="https://img.shields.io/badge/built_with-Tauri_v2-orange.svg" />
  <img src="https://img.shields.io/badge/frontend-Svelte_5-red.svg" />
</p>

<table>
  <tr>
    <td><img width="400" alt="RyokanApp Interface" src="https://github.com/user-attachments/assets/075e4ebd-62e1-4d4b-a428-ceaa7635b53e" /></td>
    <td><img width="400" alt="RyokanApp Chat" src="https://github.com/user-attachments/assets/62517ce6-ad51-4b3d-8787-e50928d58fb5" /></td>
  </tr>
  <tr>
    <td><img width="400" alt="RyokanApp Settings" src="https://github.com/user-attachments/assets/ebe082e7-f21f-4a22-9903-b2d6a461c2b4" /></td>
    <td><img width="400" alt="RyokanApp Editor" src="https://github.com/user-attachments/assets/7d8fa647-6ba4-49a8-a2f8-a0ab4fbab1c8" /></td>
  </tr>
</table>

---

## What is Ryokan?

Most AI roleplay frontends feel like cockpits. Hundreds of sliders, raw JSON, terminal prompts. Ryokan takes the opposite approach.

It gets out of the way so the story can breathe.

No clutter, no friction. Just you, your characters, and your local LLM or any compatible cloud API. Built for people who want a polished, immersive experience without sacrificing the power features underneath.

---

## Features

### Roleplay-First Design
- **Director Mode:** Step outside the story at any time to nudge the narrative or correct the AI, without breaking immersion. No clunky `[OOC]` brackets needed.
- **Edit & Retry:** Change any previous message and regenerate from that point forward.
- **Swipe to Reroll:** Browse alternate AI responses with smooth slide animations.

### Characters & World Building
- **V3 Character Support:** Full card import/export with alternate greetings, personality traits, scenarios, and example dialogs.
- **Lorebooks & World Info:** Keyword-triggered entries injected automatically into context, with full position control.
- **Persona System:** Define exactly who *you* are in the story: name, pronouns, background.
- **Ready-to-Play Content:** Pre-installed bilingual characters bundled with matching World Info, adapting automatically to your language (EN/DE).

### AI & Performance
- **Rolling Summary Engine:** Long conversations stay coherent. The summary engine compresses older context intelligently so nothing important gets lost.
- **Thinking Model Support:** Advanced budget presets and context-aware token reserves, tuned specifically for reasoning models.
- **Simplified Settings:** Dial in AI behavior (Creativity, Length, Repetition) via clean presets. Power User mode unlocks raw controls for those who want them.

### Privacy & Connectivity
- **Local Privacy First:** All chats, characters, and settings live in a local SQLite database. Nothing leaves your machine.
- **BYOK & Local Models:** Connect to LM Studio, llama.cpp, KoboldCPP, or any OpenAI-compatible endpoint. Or bring your own OpenRouter API key for cloud generation.
- **Custom API Endpoints:** Switch between local and cloud providers on the fly from settings.

### Native Bilingual
Full, consistent **English and German** support from day one.

---

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Core       | Tauri v2 (Rust)                   |
| Frontend   | Svelte 5 + TailwindCSS            |
| Database   | SQLite (local)                    |
| I18n       | ParaglideJS                       |

---

## Getting Started

### Prerequisites
- Node.js v18+
- Rust (latest stable)
- A local OpenAI-compatible server (e.g. LM Studio on `:1234`, llama.cpp on `:8080`) or a valid OpenRouter API key

### Installation
```bash
# 1. Clone the repo
git clone https://github.com/Finn-Hecker/RyokanApp.git
cd RyokanApp

# 2. Install dependencies (tokenizers are set up automatically)
npm install

# 3. Launch in dev mode
npm run tauri dev
````

No manual tokenizer downloads, no extra setup steps. The `postinstall` hook handles everything.

-----

## Contributing

Ryokan is in active Alpha and contributions are very welcome. Please open an issue before submitting a Pull Request for major changes. This helps avoid duplicate work and keeps things moving in the right direction.

-----

## License

Licensed under the **GNU General Public License v3.0**.
See the [LICENSE](https://www.google.com/search?q=LICENSE) file for details.

[](https://www.gnu.org/licenses/gpl-3.0)
