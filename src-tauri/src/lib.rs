mod ai;
mod database;
mod import;
mod export;
mod tokenizer;
mod diagnostics;

// Closing the WebView is not the Android Activity lifecycle operation.
// Run finish() on its UI thread so Android handles the closing transition.
#[tauri::command]
async fn finish_android_activity(webview: tauri::Webview) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        webview.with_webview(move |platform_webview| {
            platform_webview.jni_handle().exec(move |env, activity, _| {
                let result = env.call_method(activity, "finish", "()V", &[])
                    .map(|_| ())
                    .map_err(|error| error.to_string());
                let _ = sender.send(result);
            });
        }).map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = webview;
        Err("Finishing an Activity is only supported on Android".into())
    }
}

#[tauri::command]
fn supports_updates() -> bool {
    cfg!(windows)
}

#[tauri::command]
fn get_interaction_mode() -> &'static str {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        "mobile"
    } else {
        "desktop"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(windows)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            diagnostics::init(app.handle());
            if let Err(error) = database::init_db(app.handle()) {
                diagnostics::record(diagnostics::Event::DatabaseFailed);
                return Err(error.into());
            }
            diagnostics::record(diagnostics::Event::DatabaseReady);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_interaction_mode,
            finish_android_activity,
            supports_updates,
            diagnostics::record_frontend_event,
            diagnostics::record_diagnostic_decision,
            diagnostics::export_diagnostics,
            ai::call_ai_api,
            ai::fetch_models,
            ai::detect_context,
            ai::get_effective_api_parameter_config,
            ai::stop_generation,
            database::chats::get_conversations,
            database::chats::create_chat,
            database::chats::delete_chat,
            database::chats::rename_chat,
            database::chats::toggle_pin_chat,
            database::chats::get_conversations_page,
            database::chats::save_summary_meta,
            database::chats::compare_and_swap_summary_meta,
            database::chats::get_summary_meta,
            database::chats::clone_chat_from_message,
            database::folders::get_chat_folders,
            database::folders::create_chat_folder,
            database::folders::rename_chat_folder,
            database::folders::set_chat_folder_collapsed,
            database::folders::delete_chat_folder,
            database::folders::save_sidebar_organization,
            database::messages::get_messages,
            database::messages::add_message,
            database::messages::delete_message,
            database::messages::update_message,
            database::messages::add_swipe_variant,
            database::messages::set_swipe_index,
            database::messages::get_messages_page,
            database::settings::get_all_settings,
            database::settings::save_setting,
            database::settings::save_api_connections,
            database::characters::get_custom_characters,
            database::characters::get_character_avatar,
            database::characters::get_bundled_role_avatar,
            database::characters::get_bundled_role_snapshots,
            database::characters::create_character,
            database::characters::delete_character,
            database::characters::update_character,
            database::characters::set_character_hidden,
            database::characters::get_hidden_character_ids,
            database::characters::get_pinned_character_ids,
            database::characters::set_character_pinned,
            database::characters::set_character_role_policy,
            database::characters::add_bundled_role_snapshot,
            database::characters::remove_bundled_role_snapshot,
            database::roles::get_roles,
            database::roles::get_role_avatar,
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
