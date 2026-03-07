# RyokanApp
> **Immersive, local-first AI Roleplay Engine.**
> Built with Rust, Tauri v2, and Svelte.

![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)
![Status](https://img.shields.io/badge/status-Alpha_v0.2-green.svg)

<table>
  <tr>
    <td><img width="400" alt="RyokanApp Interface" src="https://github.com/user-attachments/assets/075e4ebd-62e1-4d4b-a428-ceaa7635b53e" /></td>
    <td><img width="400" alt="RyokanApp Chat" src="https://github.com/user-attachments/assets/62517ce6-ad51-4b3d-8787-e50928d58fb5" /></td>
  </tr>
  <tr>
    <td><img width="400" alt="RyokanApp Settings" src="https://github.com/user-attachments/assets/bbc2349a-b583-4944-8d03-129508419523" /></td>
    <td><img width="400" alt="RyokanApp ListView" src="https://github.com/user-attachments/assets/75a78093-6ec3-4408-ad61-d5dee3bfe87a" /></td>
  </tr>
  <tr>
    <td><img width="400" alt="RyokanApp Editor" src="https://github.com/user-attachments/assets/7d8fa647-6ba4-49a8-a2f8-a0ab4fbab1c8" /></td>
    <td><img width="400" alt="RyokanApp Sidebar" src="https://github.com/user-attachments/assets/78680d4a-b6b5-4f04-98af-b62a2e2e64d2" /></td>
  </tr>
</table>

## Core Features

- **Director Mode:** Step outside the story at any time to guide the narrative or the AI without breaking immersion. No clunky OOC brackets needed.
- **Clean UI:** A modern, distraction-free interface, fully migrated to Svelte 5 Runes for top performance. 
- **Ready-to-Play Content:** Includes pre-installed, multi-lingual standard characters bundled with matching World Info. They automatically adapt to your chosen language (EN/DE), allowing you to jump straight into a story without any setup.
- **Simplified Settings:** Control AI behavior (Creativity, Length, Repetition) via simple presets. A Power User toggle is available for those who still want raw slider controls.
- **BYOK & Local Models:** Connect seamlessly to LM Studio for local models, or enter your OpenRouter API key for cloud generation.
- **V3 Character Support:** Full character card import/export, including alternate greetings, personality traits, scenarios, and example dialogs.
- **Lorebooks & World Info:** Full support for world-building entries with keyword triggers and position control, injected automatically into the context.
- **Persona System:** Define exactly who *you* are in the story (name, pronouns, background).
- **Edit & Retry:** Easily edit any previous message and regenerate the response from that specific point.
- **Local Privacy First:** All chats, characters, and settings are stored locally via SQLite. Nothing leaves your machine.
- **Native Bilingual:** Full, consistent English and German support from day one.

## The Vision

The current landscape of AI roleplay frontends is often cluttered with hundreds of technical sliders, terminal-like interfaces, and overwhelming settings. RyokanApp takes a different approach: **Atmosphere and Immersion**. 

Designed to be a **clean, distraction-free chat experience**, it strips away the complexity so you can focus entirely on the story and the characters. Driven entirely by your local LLM or any compatible API, Ryokan is built for those who want plug-and-play roleplay without sacrificing powerful features under the hood.

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

## Contributing

Contributions are welcome! Please open an issue before submitting a Pull Request to discuss major changes.

## License

This project is licensed under the **GNU General Public License v3.0**, see the [LICENSE](LICENSE) file for details.

[![GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
