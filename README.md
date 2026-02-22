# RyokanApp

> **Building an immersive, local-first AI Roleplay Engine.**
> Zero-config. Zero-tracking. Built with Rust, Tauri v2, and Svelte.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-Alpha_v0.1-orange.svg)

<p align="center">
  <img width="700" alt="RyokanApp Interface" src="https://github.com/user-attachments/assets/f93fb3e2-1c1c-47ce-a280-62f02e849bf2" />
</p>

---


## ⚠️ Current State: Early Alpha (v0.1)

Please read before installing! RyokanApp is currently in heavy development. It is **not** feature-complete and the UI is still a work in progress.

**What works today:**
- **BYOK & Local Models:** Connect to your local LLM (LM Studio, Ollama) or enter your own API key.
- **Character Creation (V3 Support):** Create custom characters with alternate greetings and personality traits. Avatars are automatically compressed to WebP (92%) and stored entirely locally.
- **Bilingual Adaptive Characters:** Default companions dynamically adapt to your system's UI language (EN/DE).
- **Local Privacy:** Everything runs entirely on your machine via a local SQLite database.

---

## The Vision

The current landscape of AI roleplay frontends is cluttered with hundreds of technical sliders and settings. RyokanApp takes a different approach: **Atmosphere and Immersion**. It is designed to feel less like a complex chat terminal and more like a dynamic Visual Novel engine, driven entirely by your local LLM or any compatible API model.

---

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Core       | Tauri v2 (Rust)                   |
| Frontend   | Svelte 5 + TailwindCSS            |
| Database   | SQLite (local)                    |
| I18n       | ParaglideJS Adapter for SvelteKit |

---

## Getting Started

### Prerequisites

- Node.js (v18+)
- Rust (latest stable)
- An AI provider running locally (e.g., LM Studio on port `1234`) or a valid API key.

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

---

## Contributing

Contributions are welcome! Since this is an Alpha project, please open an issue before submitting a Pull Request to discuss major architectural changes.

---

## License

This project is licensed under the **GPL-3.0 License** - see the [LICENSE](LICENSE) file for details.
