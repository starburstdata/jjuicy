use super::*;

#[test]
fn parse_default_theme() {
    let theme = default_theme();
    // light variant has expected tokens
    assert_eq!(
        theme.light.get("colors-primary"),
        Some(&"#007AFF".to_string())
    );
    assert_eq!(
        theme.light.get("colors-background"),
        Some(&"#ffffff".to_string())
    );
    assert!(theme.light.contains_key("text-familyUi"));
    assert!(theme.light.contains_key("shadows-shadowSm"));
    assert!(theme.light.contains_key("components-buttonHeight"));

    // dark variant has expected tokens
    assert_eq!(
        theme.dark.get("colors-primary"),
        Some(&"#0A84FF".to_string())
    );
    assert!(theme.dark.contains_key("components-buttonBackground"));
}

#[test]
fn resolve_references() {
    let theme = default_theme();
    // components.buttonBackground should resolve to colors.primary
    assert_eq!(
        theme.light.get("components-buttonBackground"),
        theme.light.get("colors-primary"),
    );
    // components.buttonForeground should resolve to colors.primaryContent
    assert_eq!(
        theme.light.get("components-buttonForeground"),
        theme.light.get("colors-primaryContent"),
    );
}

#[test]
fn resolve_cross_section_refs() {
    let theme = default_theme();
    // components.dialogShadow references shadows.shadowLg
    assert_eq!(
        theme.light.get("components-dialogShadow"),
        theme.light.get("shadows-shadowLg"),
    );
    // components.buttonFont references text.familyUi
    assert_eq!(
        theme.light.get("components-buttonFont"),
        theme.light.get("text-familyUi"),
    );
}

#[test]
fn unresolved_ref_kept_literally() {
    let toml = r##"
[light.colors]
primary = "#ff0000"

[light.text]
[light.shadows]

[light.components]
buttonBackground = "$colors.nonexistent"

[dark.colors]
primary = "#ff0000"
[dark.text]
[dark.shadows]
[dark.components]
"##;
    let theme = parse_theme(toml).unwrap();
    assert_eq!(
        theme.light.get("components-buttonBackground"),
        Some(&"$colors.nonexistent".to_string()),
    );
}

#[test]
fn parse_all_bundled_themes() {
    // every bundled theme defines every default token itself, without inheriting
    let default = default_theme();
    for (name, content) in BUNDLED_THEMES {
        let theme = parse_theme_standalone(content).unwrap();
        for (variant, tokens, defaults) in [
            ("light", &theme.light, &default.light),
            ("dark", &theme.dark, &default.dark),
        ] {
            for key in defaults.keys() {
                assert!(
                    tokens.contains_key(key),
                    "{name} [{variant}] is missing {key}"
                );
            }
            for (key, value) in tokens {
                assert!(
                    !value.contains('$'),
                    "{name} [{variant}] {key} has unresolved ref: {value}"
                );
            }
        }
    }
}

#[test]
fn partial_theme_inherits_defaults() {
    let toml = r##"
[light.colors]
primary = "#ff0000"

[dark.colors]
primary = "#00ff00"
"##;
    let theme = parse_theme(toml).unwrap();
    let default = default_theme();
    assert_eq!(theme.light.len(), default.light.len());
    assert_eq!(theme.dark.len(), default.dark.len());
    assert_eq!(
        theme.light.get("colors-primary"),
        Some(&"#ff0000".to_string())
    );
    assert_eq!(
        theme.light.get("text-familyCode"),
        default.light.get("text-familyCode")
    );
    // inherited refs resolve against the custom theme's values
    assert_eq!(
        theme.light.get("components-buttonBackground"),
        Some(&"#ff0000".to_string())
    );
    assert_eq!(
        theme.dark.get("colors-selectionBar"),
        Some(&"#00ff00".to_string())
    );
}

#[test]
fn diff_and_syntax_tokens() {
    let theme = default_theme();
    for key in [
        "colors-diffAddBg",
        "colors-diffAddWordBg",
        "colors-diffDelBg",
        "colors-diffDelWordBg",
        "colors-gutter",
        "colors-selectionBar",
        "colors-chipConflictBg",
        "syntax-keyword",
        "syntax-string",
        "syntax-comment",
        "text-sizeTitle",
    ] {
        assert!(theme.light.contains_key(key), "missing {key}");
        assert!(theme.dark.contains_key(key), "missing {key}");
    }
}

#[test]
fn ref_cycle_terminates() {
    let toml = r##"
[light.colors]
a = "$colors.b"
b = "$colors.a"

[dark.colors]
"##;
    parse_theme(toml).unwrap();
}

#[test]
fn five_surface_tiers() {
    let theme = default_theme();
    // verify all 5 surface tiers exist
    assert!(theme.light.contains_key("colors-background"));
    assert!(theme.light.contains_key("colors-surfaceDeep"));
    assert!(theme.light.contains_key("colors-surface"));
    assert!(theme.light.contains_key("colors-surfaceAlt"));
    assert!(theme.light.contains_key("colors-surfaceStrong"));
}

#[test]
fn graph_node_tokens() {
    let theme = default_theme();
    assert!(theme.light.contains_key("colors-immutableStroke"));
    assert!(theme.light.contains_key("colors-immutableFill"));
    assert!(theme.light.contains_key("colors-mutableStroke"));
    assert!(theme.light.contains_key("colors-mutableFill"));
    assert!(theme.light.contains_key("colors-workingCopyStroke"));
    assert!(theme.light.contains_key("colors-workingCopyFill"));
    assert!(theme.light.contains_key("colors-conflictStroke"));
    assert!(theme.light.contains_key("colors-conflictFill"));
}
