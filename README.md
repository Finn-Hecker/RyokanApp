# Ryokan

> **Your characters. Your choices. A story you can share.**
> An AI roleplay app for Windows and Android. Play solo or invite friends to join from their browser.

Connect an AI model, choose a character, and step into a conversation that grows with your decisions. Create your own worlds, try another direction, or bring friends into the same story.

**[Download Ryokan](https://github.com/Finn-Hecker/RyokanApp/releases)**

<p>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" />
  <img src="https://img.shields.io/badge/status-Alpha_v0.6-green.svg" />
  <img src="https://img.shields.io/badge/multiplayer-Beta-purple.svg" />
  <img src="https://img.shields.io/badge/built_with-Tauri_v2-orange.svg" />
  <img src="https://img.shields.io/badge/frontend-Svelte_5-red.svg" />
  <img src="https://img.shields.io/badge/platforms-Windows_%7C_Android-blueviolet.svg" />
</p>

<table>
  <tr>
    <td>
      <img width="210" alt="Ryokan Interface"
           src="https://github.com/user-attachments/assets/ec3ab47b-0431-4e60-a5c8-83d16ca9ba36" />
    </td>
    <td>
      <img width="210" alt="Ryokan Chat"
           src="https://github.com/user-attachments/assets/93c00213-f69f-4f1a-a6f8-71f826663af9" />
    </td>
    <td rowspan="2">
      <img width="210" alt="Ryokan Mobile Interface"
           src="https://github.com/user-attachments/assets/1b300157-041f-4b50-b563-3c63238bd649" />
    </td>
    <td rowspan="2">
      <img width="210" alt="Ryokan Mobile Chat"
           src="https://github.com/user-attachments/assets/ac974b31-36ad-436d-84c9-67fbf6cba2d2" />
    </td>
  </tr>

  <tr>
    <td>
      <img width="210" alt="Ryokan Settings"
           src="https://github.com/user-attachments/assets/093e4bb2-5cf1-478b-9ea4-6ae37a4f004d" />
    </td>
    <td>
      <img width="210" alt="Ryokan Multiplayer"
           src="https://github.com/user-attachments/assets/afc78fe2-284e-49c3-8810-298f4bd53832" />
    </td>
  </tr>
</table>

***

## What is Ryokan?

Most AI roleplay frontends feel like control panels.

Raw JSON, endless settings, terminal setup, and dozens of options before you can even start a conversation.

Ryokan takes the opposite approach.

It is a native AI roleplay app designed to stay out of the way once the story begins. Download the app, connect your local model or API, pick a character or scenario, and start playing.

The advanced controls are still there when you want them. They just do not need to be the first thing you see.

***

## Solo or Multiplayer

Ryokan works as a traditional solo AI roleplay app, but stories do not have to stay single player.

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
* **End to End Encryption:** Story content is encrypted on the client before it passes through the relay. The relay never receives the room key.

***

## Features

### Roleplay First

* **Director Mode:** Step outside the story to guide the narrative or correct the AI without filling the conversation with OOC messages.
* **Edit & Retry:** Edit your latest message and regenerate the AI response.
* **Swipe to Reroll:** Move between alternative AI responses without losing previous generations.
* **Chat Cloning:** Branch an existing conversation into a new chat and explore another direction without destroying the original.
* **Chat Organization:** Group conversations into folders, pin important chats, rename them, and keep larger libraries manageable.

### Characters & Scenarios

* **V3 Character Cards:** Import and export compatible character cards, including linked lorebooks and Ryokan role data where supported.
* **Player Roles:** Create reusable roles for who you play, set a default role, or use roles bundled with individual characters.
* **Lorebooks & World Info:** Automatically inject relevant context when keywords appear.
* **Alternate Greetings:** Characters can start conversations in different ways.
* **Ready to Play Content:** Ryokan includes built in characters and scenarios so you can start without downloading anything first.
* **Solo & Multiplayer Scenarios:** Experiences can be designed specifically for one player or a group.

### AI & Context

* **Local Models:** Connect to LM Studio, llama.cpp, KoboldCPP, Ollama, or other compatible servers.
* **Cloud APIs:** Use OpenRouter or other compatible providers.
* **Saved Connections:** Keep multiple AI setups and switch between them easily.
* **Automatic Context Management:** Ryokan can detect supported model limits and manage conversation history automatically.
* **Rolling Summaries:** Older parts of long conversations can be summarized to preserve important context.
* **Thinking Model Support:** Models with separate reasoning or thinking output are supported.
* **Simple Settings:** Common controls stay easy to use.
* **Advanced Controls:** More detailed options are available when you need them.

### Local First

Chats, characters, roles, lorebooks, settings, and saved sessions are stored locally in SQLite.

Single player conversations do not require a Ryokan server.

For multiplayer, encrypted session traffic is passed through a relay so remote players can stay synchronized. AI generation still happens through the host's configured local model or API.

***

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

Power user features are available when you need them without defining the default experience.

***

## Platforms

Ryokan currently runs natively on:

* **Windows:** x64
* **Android:** arm64

Prebuilt versions are available from the [Releases page](https://github.com/Finn-Hecker/RyokanApp/releases).

Ryokan supports signed automatic updates on Windows. Android updates are available through the Releases page.

Multiplayer guests can join supported sessions directly through their browser.

***

## Tech Stack

| Layer                  | Technology                        |
| ---------------------- | --------------------------------- |
| Native Core            | Tauri v2 + Rust                   |
| Frontend               | Svelte 5 + TailwindCSS            |
| Database               | SQLite                            |
| Internationalization   | ParaglideJS                       |
| Multiplayer Transport  | WebSocket relay                   |
| Multiplayer Encryption | Client side end to end encryption |

***

## Languages

Ryokan includes native interface support for:

* **English**
* **German**

Built in characters and scenarios are available in both languages where supported.

***

## Getting Started

> **Just want to use Ryokan?**
> Download a prebuilt version from [Releases](https://github.com/Finn-Hecker/RyokanApp/releases). You do not need development tools.

### Building from Source

#### Prerequisites

* Node.js v18+
* Rust stable
* The platform requirements for Tauri v2
* An OpenAI compatible model server or compatible cloud API

```bash
git clone https://github.com/Finn-Hecker/RyokanApp.git
cd RyokanApp

npm install

npm run tauri dev
```

The project handles its required tokenizer setup automatically during installation.

***

## Contributing

Ryokan is under active development and contributions are welcome.

For larger changes, please open an issue before submitting a pull request so the idea can be discussed first and duplicate work can be avoided.

Bug reports, compatibility reports, UI improvements, translations, and focused pull requests are especially useful.

***

## License

Ryokan is licensed under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) for details.