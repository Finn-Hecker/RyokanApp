# Ryokan (Alpha)

> **An immersive, local-first AI Roleplay Engine.** > Built with Rust, Tauri v2, and Svelte.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-Alpha-orange.svg)
![Stack](https://img.shields.io/badge/stack-Rust%20|%20Svelte%20|%20Tauri-red.svg)

## 📖 About

Ryokan is a modern desktop app that turns your local AI into an immersive roleplay engine, blending the power of LLMs with a visual-novel-style experience.

Unlike other frontends that focus on hundreds of technical sliders, Ryokan focuses on **atmosphere and immersion**. It is designed to feel less like a "chat tool" and more like a dynamic Visual Novel engine driven by your local LLM.

**⚠️ Status:** This project is currently in **Early Alpha**. 
We are actively building the core architecture. Expect breaking changes, bugs, and rapid feature updates.

## ✨ Features

* **Local First:** Your chats and data stay on your machine (SQLite).
* **Modern Stack:** High-performance backend in **Rust**, reactive frontend in **Svelte 5**.
* **Universal API Support:** Works out-of-the-box with LM Studio, Ollama, and OpenAI-compatible endpoints.
* **Internationalization:** Built-in i18n support (English/German) powered by [Paraglide JS](https://inlang.com/).
* **Zero-Config:** Designed to "just work" without requiring a degree in prompt engineering.

## 🛠️ Tech Stack

We use a modern Rust + Tauri + Svelte stack for performance and native OS integration:

* **Core:** [Tauri v2](https://tauri.app/) (Rust)
* **Frontend:** Svelte 5 + TailwindCSS
* **Database:** SQLite (local)
* **I18n:** Paraglide JS Adapter SvelteKit

## 🚀 Getting Started

### Prerequisites
* Node.js (v18+)
* Rust (latest stable)
* An AI provider running locally (e.g., LM Studio with a local server on port 1234)

### Installation

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/Finn-Hecker/ryokan.git](https://github.com/Finn-Hecker/ryokan.git)
    cd ryokan
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run in Development Mode**
    ```bash
    npm run tauri dev
    ```

## 🤝 Contributing

Contributions are welcome! Since this is an Alpha project, please open an issue before submitting a Pull Request to discuss major changes.

**Note:** We value a positive and constructive community. Constructive feedback is appreciated; toxicity is not.

---

*Built with ❤️ in Rust & Svelte.*