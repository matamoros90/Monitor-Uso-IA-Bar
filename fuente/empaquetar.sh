#!/bin/bash
# Construye una copia independiente usando el Electron que ya trae Medidor.
# Nunca elimina ni modifica el proyecto o la app original.
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$(dirname "$source_dir")"
original="${MEDIDOR_ORIGINAL_APP:-$HOME/Documents/Medidor/Medidor.app}"
destination="${MEDIDOR_OUTPUT_APP:-$output_dir/Medidor-redisenado.app}"
if [[ ! -d "$original/Contents/Frameworks/Electron Framework.framework" ]]; then
  printf 'No se encontró Medidor.app original: %s\n' "$original" >&2; exit 1
fi
if [[ -e "$destination" ]]; then
  printf 'Ya existe %s. Muévela o elige otra carpeta antes de compilar.\n' "$destination" >&2; exit 1
fi
temporary="$(mktemp -d "${TMPDIR:-/tmp}/medidor-build.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
app_path="$temporary/Medidor-redisenado.app"
ditto --norsrc --noextattr "$original" "$app_path"
resource_dir="$app_path/Contents/Resources/app"
mkdir -p "$resource_dir/assets"
rm -f "$resource_dir"/{view.js,preload.js,settings.html}
cp "$source_dir"/{main.js,usage.js,providers.js,package.json,panel.html,panel.css,panel.js,panel-preload.js,panel-state.js,panel-presentation.js,codex-client.js} "$resource_dir/"
cp "$source_dir"/assets/{trayTemplate.png,trayTemplate@2x.png} "$resource_dir/assets/"
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 1.4.0' "$app_path/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 1.4.0' "$app_path/Contents/Info.plist"
xattr -cr "$app_path"
codesign --force --deep --sign - "$app_path"
codesign --verify --deep --strict "$app_path"
ditto --norsrc --noextattr "$app_path" "$destination"
printf 'App creada: %s\n' "$destination"
