use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

use crate::config::StatuslineSegmentConfig;

pub fn strip_ansi(text: &str) -> String {
    let pattern = regex::Regex::new(r"\x1B\[[0-9;]*m").expect("valid regex");
    pattern.replace_all(text, "").to_string()
}

pub fn visible_width(text: &str) -> usize {
    UnicodeWidthStr::width(strip_ansi(text).as_str())
}

fn ensure_ansi_reset(text: &str) -> String {
    let pattern = regex::Regex::new(r"\x1B\[[0-9;]*m").expect("valid regex");
    if pattern.is_match(text) && !text.ends_with("\u{1b}[0m") {
        return format!("{text}\u{1b}[0m");
    }
    text.to_string()
}

pub fn truncate_visible(text: &str, max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }
    if visible_width(text) <= max_width {
        return text.to_string();
    }
    if max_width == 1 {
        return "…".to_string();
    }

    let target_width = max_width - 1;
    let ansi_pattern = regex::Regex::new(r"\x1B\[[0-9;]*m").expect("valid regex");
    let mut output = String::new();
    let mut current_width = 0usize;
    let mut last_index = 0usize;

    for matched in ansi_pattern.find_iter(text) {
        let plain = &text[last_index..matched.start()];
        for grapheme in plain.graphemes(true) {
            let width = UnicodeWidthStr::width(grapheme);
            if current_width + width > target_width {
                return ensure_ansi_reset(&format!("{output}…"));
            }
            output.push_str(grapheme);
            current_width += width;
        }
        output.push_str(matched.as_str());
        last_index = matched.end();
    }

    for grapheme in text[last_index..].graphemes(true) {
        let width = UnicodeWidthStr::width(grapheme);
        if current_width + width > target_width {
            return ensure_ansi_reset(&format!("{output}…"));
        }
        output.push_str(grapheme);
        current_width += width;
    }

    ensure_ansi_reset(&format!("{output}…"))
}

pub fn pad_visible(text: &str, width: usize) -> String {
    let current = visible_width(text);
    if current >= width {
        return truncate_visible(text, width);
    }
    format!("{text}{}", " ".repeat(width - current))
}

pub fn render_tmux_statusline_segment(content: &str, config: &StatuslineSegmentConfig) -> String {
    if content.is_empty() {
        return String::new();
    }
    let weight = if config.bold { "bold" } else { "nobold" };
    let mut output = String::new();
    if !config.prefix.is_empty() {
        output.push_str(&format!(
            "#[fg={},bg={},nobold]{}",
            config.colors.bg, config.colors.outer_bg, config.prefix
        ));
    }
    output.push_str(&format!(
        "#[fg={},bg={},{}]{}",
        config.colors.fg, config.colors.bg, weight, content
    ));
    if !config.suffix.is_empty() {
        output.push_str(&format!(
            "#[fg={},bg={},nobold]{}",
            config.colors.bg, config.colors.outer_bg, config.suffix
        ));
    }
    output.push_str("#[default]");
    output
}
