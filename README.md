# RyokanApp
> **Immersive, local-first AI Roleplay Engine.**
> Built with Rust, Tauri v2, and Svelte.

![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)
![Status](https://img.shields.io/badge/status-Beta_v0.2-green.svg)

<table>
  <tr>
    <td><img width="400" alt="RyokanApp Interface" src="https://github.com/user-attachments/assets/075e4ebd-62e1-4d4b-a428-ceaa7635b53e" /></td>
    <td><img width="400" alt="RyokanApp Chat" src="https://github.com/user-attachments/assets/62517ce6-ad51-4b3d-8787-e50928d58fb5" /></td>
  </tr>
  <tr>
    <td><img width="400" alt="RyokanApp Settings" src="https://github.com/user-attachments/assets/bbc2349a-b583-4944-8d03-129508419523" /></td>
    <td><img width="400" alt="RyokanApp ListView" src="https://github.com/user-attachments/assets/75a78093-6ec3-4408-ad61-d5dee3bfe87a" /></td>
  </tr>
</table>

## What's new in v0.2

- **Director Mode (Regie):** Step outside the story at any time to guide the narrative without breaking immersion. No other frontend has this as a dedicated feature.
- **Lorebooks & World Info:** Full support for world-building entries with keyword triggers and position control.
- **Persona System:** Define who *you* are in the story, name, pronouns, bio.
- **Svelte 5 Migration:** Fully migrated to Svelte 5 Runes for better performance.
- **Settings overhaul:** Simplified AI behavior settings (Creativity, Response Length, Repetition) with no more raw sliders. Power User toggle for advanced controls.
- **Edit & Retry:** Edit any previous message and regenerate the response from that point.
- **Bug fixes & UI polish**

## What works in v0.2

- **BYOK & Local Models:** Connect to LM Studio or enter your OpenRouter API key.
- **Character Creation (V3 Support):** Full V3 card import/export with alternate greetings, personality, scenario and example dialog.
- **Director Mode:** Guide the story out-of-character without breaking immersion.
- **Lorebooks:** Keyword-triggered world info injected automatically into context.
- **Persona:** Define your own role in the story.
- **Bilingual:** Full EN/DE support from day one.
- **Local Privacy:** SQLite, nothing leaves your machine.

## The Vision

The current landscape of AI roleplay frontends is cluttered with hundreds of technical sliders and settings. RyokanApp takes a different approach: **Atmosphere and Immersion**. Designed to feel less like a complex chat terminal and more like a dynamic Visual Novel engine, driven entirely by your local LLM or any compatible API.

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Core       | Tauri v2 (Rust)                   |
| Frontend   | Svelte 5 + TailwindCSS            |
| Database   | SQLite (local)                    |
| I18n       | ParaglideJS                       |

## Getting Started

### Prerequisites
- Node.js (v18+)
- Rust (latest stable)
- LM Studio running locally on port `1234`, or a valid OpenRouter API key.

### Installation

1. **Clone the repository**
```bash
   git clone https://github.com/Finn-Hecker/RyokanApp.git
   cd RyokanApp
```

2. **Install dependencies**
```bash
   npm install
```

3. **Run in development mode**
```bash
   npm run tauri dev
```

## Roadmap

- [ ] Ollama support
- [ ] Memory summarization

## Contributing

Contributions are welcome! Please open an issue before submitting a Pull Request to discuss major changes.

## License

This project is licensed under the **GNU General Public License v3.0**, see the [LICENSE](LICENSE) file for details.

[![GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
