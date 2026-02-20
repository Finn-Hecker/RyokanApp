#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod database;
mod import;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            database::init_db(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::call_ai_api,
            ai::fetch_models,
            database::chats::get_conversations,
            database::chats::create_chat,
            database::chats::delete_chat,
            database::messages::get_messages,
            database::messages::add_message,
            database::settings::get_all_settings,
            database::settings::save_setting,
            database::characters::get_custom_characters,
            database::characters::create_character,
            import::parse_character_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}