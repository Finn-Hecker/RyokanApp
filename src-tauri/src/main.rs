#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod database;
mod import;
mod export;
mod tokenizer;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            database::init_db(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::call_ai_api,
            ai::fetch_models,
            ai::stop_generation,
            database::chats::get_conversations,
            database::chats::create_chat,
            database::chats::delete_chat,
            database::chats::rename_chat,
            database::chats::toggle_pin_chat,
            database::chats::get_conversations_page,
            database::chats::save_summary_meta,
            database::chats::get_summary_meta,
            database::messages::get_messages,
            database::messages::add_message,
            database::messages::delete_message,
            database::messages::update_message,
            database::messages::add_swipe_variant,
            database::messages::set_swipe_index,
            database::settings::get_all_settings,
            database::settings::save_setting,
            database::characters::get_custom_characters,
            database::characters::create_character,
            database::characters::delete_character,
            database::characters::update_character,
            database::characters::set_character_hidden,
            database::characters::get_hidden_character_ids,
            database::characters::get_pinned_character_ids,
            database::characters::set_character_pinned,
            database::roles::get_roles,
            database::roles::create_role,
            database::roles::update_role,
            database::roles::delete_role,
            import::parse_character_card,
            tokenizer::count_tokens,
            export::export_character_card,
            database::world_info::get_world_infos,
            database::world_info::create_world_info,
            database::world_info::update_world_info,
            database::world_info::delete_world_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}