# Ryokan

> **Immersive, local-first AI roleplay — built for atmosphere, not spreadsheets.**
> Play solo or invite friends into the same story with accountless, end-to-end encrypted multiplayer.

Powered by Rust, Tauri v2, and Svelte 5.

<p>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" />
  <img src="https://img.shields.io/badge/status-Alpha_v0.5-green.svg" />
  <img src="https://img.shields.io/badge/multiplayer-Beta-purple.svg" />
  <img src="https://img.shields.io/badge/built_with-Tauri_v2-orange.svg" />
  <img src="https://img.shields.io/badge/frontend-Svelte_5-red.svg" />
  <img src="https://img.shields.io/badge/platforms-Windows_%7C_Android-blueviolet.svg" />
</p>

<table>
  <tr>
    <td><img width="400" alt="Ryokan Interface" src="https://github.com/user-attachments/assets/075e4ebd-62e1-4d4b-a428-ceaa7635b53e" /></td>
    <td><img width="400" alt="Ryokan Chat" src="https://github.com/user-attachments/assets/62517ce6-ad51-4b3d-8787-e50928d58fb5" /></td>
  </tr>
  <tr>
    <td><img width="400" alt="Ryokan Settings" src="https://github.com/user-attachments/assets/ebe082e7-f21f-4a22-9903-b2d6a461c2b4" /></td>
    <td><img width="400" alt="Ryokan Editor" src="https://github.com/user-attachments/assets/7d8fa647-6ba4-49a8-a2f8-a0ab4fbab1c8" /></td>
  </tr>
</table>

---

## What is Ryokan?

Most AI roleplay frontends feel like control panels.

Raw JSON, endless settings, terminal setup, and dozens of options before you can even start a conversation.

Ryokan takes the opposite approach.

It is a native AI roleplay app designed to stay out of the way once the story begins. Download the app, connect your local model or API, pick a character or scenario, and start playing.

The advanced controls are still there when you want them — they just do not need to be the first thing you see.

---

## Solo or Multiplayer

Ryokan works as a traditional solo AI roleplay app, but stories do not have to stay single-player.

The host runs Ryokan and provides the AI connection. Friends can join the same session directly from their browser using an invite link.

They do not need a Ryokan installation, an account, an API key, or their own language model.

### Multiplayer includes

* **Browser Guests:** Friends join using a simple invite link.
* **No Accounts:** Multiplayer sessions do not require user accounts.
* **Shared Roleplay:** Players and the AI participate in the same synchronized conversation.
* **Live AI Streaming:** Everyone sees the response as it is generated.
* **Typing Indicators:** See when another player is writing.
* **Shared Characters & Scenarios:** The host chooses the experience for the room.
* **Generation Control:** The host can decide whether other players may trigger AI responses.
* **Saved Sessions:** Multiplayer conversations are stored locally and can later be reopened or hosted again.
* **End-to-End Encryption:** Story content is encrypted on the client before it passes through the relay. The relay never receives the room key.

> Multiplayer is currently in beta and may still change as the system evolves.

---

## Features

### Roleplay First

* **Director Mode:** Step outside the story to guide the narrative or correct the AI without filling the conversation with OOC messages.
* **Edit & Retry:** Edit your latest message and regenerate the AI response.
* **Swipe to Reroll:** Move between alternative AI responses without losing previous generations.
* **Chat Cloning:** Branch an existing conversation into a new chat and explore another direction without destroying the original.

### Characters & Scenarios

* **V3 Character Cards:** Import and export compatible character cards.
* **Lorebooks & World Info:** Automatically inject relevant context when keywords appear.
* **Alternate Greetings:** Characters can start conversations in different ways.
* **Ready-to-Play Content:** Ryokan includes built-in characters and scenarios so you can start without downloading anything first.
* **Solo & Multiplayer Scenarios:** Experiences can be designed specifically for one player or a group.

### AI & Context

* **Local Models:** Connect to LM Studio, llama.cpp, KoboldCPP, or other OpenAI-compatible servers.
* **Cloud APIs:** Use OpenRouter or your own compatible API endpoint.
* **Rolling Summaries:** Older parts of long conversations can be compressed to preserve important context.
* **Thinking Model Support:** Ryokan supports models that use separate reasoning or thinking output.
* **Simple Settings:** Common controls such as creativity, response length, and repetition are presented in a human-friendly way.
* **Advanced Controls:** Power users can configure individual sampling parameters when needed.

### Local-First

Chats, characters, settings, and saved sessions are stored locally in SQLite.

Single-player conversations do not require a Ryokan server.

For multiplayer, encrypted session traffic is passed through a relay so remote players can stay synchronized. AI generation still happens through the host's configured local model or API.

---

## Built Like an App, Not a Toolkit

Ryokan is designed for people who want to roleplay, not spend an evening configuring their frontend.

For normal use:

* Download the app.
* Open it.
* Connect your model or API.
* Start playing.

No Docker setup.
No Git clone.
No manually edited configuration files.
No terminal required.

Power-user features are available when you need them without defining the default experience.

---

## Platforms

Ryokan currently runs natively on:

* **Windows** — x64
* **Android** — arm64

Prebuilt versions are available from the [Releases page](https://github.com/Finn-Hecker/RyokanApp/releases).

Multiplayer guests can join supported sessions directly through their browser.

---

## Tech Stack

| Layer                  | Technology                        |
| ---------------------- | --------------------------------- |
| Native Core            | Tauri v2 + Rust                   |
| Frontend               | Svelte 5 + TailwindCSS            |
| Database               | SQLite                            |
| Internationalization   | ParaglideJS                       |
| Multiplayer Transport  | WebSocket relay                   |
| Multiplayer Encryption | Client-side end-to-end encryption |

---

## Languages

Ryokan includes native interface support for:

* **English**
* **German**

Built-in characters and scenarios are available in both languages where supported.

---

## Getting Started

> **Just want to use Ryokan?**
> Download a prebuilt version from [Releases](https://github.com/Finn-Hecker/RyokanApp/releases). You do not need development tools.

### Building from Source

#### Prerequisites

* Node.js v18+
* Rust stable
* The platform requirements for Tauri v2
* An OpenAI-compatible model server or compatible cloud API

```bash
git clone https://github.com/Finn-Hecker/RyokanApp.git
cd RyokanApp

npm install

npm run tauri dev
```

The project handles its required tokenizer setup automatically during installation.

---

## Contributing

Ryokan is under active development and contributions are welcome.

For larger changes, please open an issue before submitting a pull request so the idea can be discussed first and duplicate work can be avoided.

Bug reports, compatibility reports, UI improvements, translations, and focused pull requests are especially useful.

---

## License

Ryokan is licensed under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) for details.
