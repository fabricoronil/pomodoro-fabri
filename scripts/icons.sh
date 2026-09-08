#!/usr/bin/env bash
#
# Genera TODOS los íconos de la app (web, PWA y escritorio) a partir de una
# sola imagen. Es la única fuente de verdad del logo.
#
#   ./scripts/icons.sh                                # usa scripts/logo.* (la fuente del repo)
#   ./scripts/icons.sh ~/Pictures/logo.png            # usa otra imagen y la guarda como fuente
#   ./scripts/icons.sh ~/Pictures/logo.png "#ffffff"  # además, fondo blanco para el relleno
#   ./scripts/icons.sh ~/Pictures/logo.png auto 80    # y el logo al 80% en los maskable
#
# La imagen puede ser png/jpg/webp/svg y de cualquier proporción: se recorta
# cuadrada desde el centro. Lo que sale:
#
#   app/icon.png                    ícono de la pestaña (y de los favoritos)
#   app/favicon.ico                 lo mismo en .ico, para navegadores viejos
#   app/apple-icon.png              iPhone/iPad: "Compartir → Agregar a inicio"
#   public/apple-touch-icon.png     copia en la ruta clásica, por si iOS la pide sola
#   public/icon-192.png             Android / escritorio, ícono tal cual
#   public/icon-512.png             idem, tamaño grande (splash de Android)
#   public/icon-maskable-*.png      Android recorta el ícono a la forma del sistema
#                                   (círculo, squircle...): todo lo que importa tiene
#                                   que entrar en el círculo central del 80%.
#   desktop/build/icon.png|.ico     el .exe de Electron y su instalador
#
# Requiere ImageMagick (paquete `imagemagick`).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BG="${2:-auto}"    # color con que se rellena; "auto" = el del borde de la imagen
SAFE="${3:-100}"   # % del cuadro que ocupa el logo en los maskable (ver abajo)

# SAFE=100 porque el logo del proyecto ya viene con su propio margen: el dibujo
# entra entero en el círculo central del 80% y lo único que Android recorta son
# las puntas del cuadrado redondeado, que es fondo. Si algún día el logo va a
# sangre (llega hasta el borde), pasale 80 para que no lo mutile.

# Sin argumento: la fuente guardada en el repo (scripts/logo.png|jpg|svg|webp).
SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  for f in "$ROOT"/scripts/logo.{png,jpg,jpeg,webp,svg}; do
    [[ -f "$f" ]] && SRC="$f" && break
  done
fi

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "No hay imagen fuente. Pasá una: $0 <imagen> [color-de-fondo]" >&2
  echo "(o dejá el logo en $ROOT/scripts/logo.png)" >&2
  exit 1
fi

command -v magick >/dev/null || { echo "falta ImageMagick: sudo pacman -S imagemagick" >&2; exit 1; }

# Los SVG hay que rasterizarlos grande antes de escalar, si no salen pixelados.
READ_OPTS=(-background none)
[[ "${SRC,,}" == *.svg ]] && READ_OPTS+=(-density 512)

# "auto": tomamos el color de la esquina de la imagen, así el relleno de los
# maskable no se nota como un marco.
if [[ "$BG" == "auto" ]]; then
  BG="#$(magick "${READ_OPTS[@]}" "$SRC" -gravity northwest -crop 32x32+0+0 +repage \
          -alpha remove -resize 1x1 -format "%[hex:p{0,0}]" info:)"
  echo "Fondo detectado: $BG"
fi

# Recorte cuadrado centrado + aplanado sobre el fondo (los PNG con transparencia
# se ven mal como ícono de iOS, que no soporta alpha).
cuadrado() { # cuadrado <tamaño> <destino>
  mkdir -p "$(dirname "$2")"
  magick "${READ_OPTS[@]}" "$SRC" \
    -filter Lanczos -resize "${1}x${1}^" -gravity center -extent "${1}x${1}" \
    -background "$BG" -alpha remove -alpha off \
    -strip -define png:compression-level=9 "$2"
}

# Igual pero con el logo al 80%, centrado: la "safe zone" de los íconos maskable.
maskable() { # maskable <tamaño> <destino>
  local inner=$(( $1 * SAFE / 100 ))
  magick "${READ_OPTS[@]}" "$SRC" \
    -filter Lanczos -resize "${inner}x${inner}^" -gravity center -extent "${inner}x${inner}" \
    -background "$BG" -extent "${1}x${1}" -alpha remove -alpha off \
    -strip -define png:compression-level=9 "$2"
}

cuadrado 256 "$ROOT/app/icon.png"
cuadrado 180 "$ROOT/app/apple-icon.png"
cp "$ROOT/app/apple-icon.png" "$ROOT/public/apple-touch-icon.png"
cuadrado 192 "$ROOT/public/icon-192.png"
cuadrado 512 "$ROOT/public/icon-512.png"
maskable 192 "$ROOT/public/icon-maskable-192.png"
maskable 512 "$ROOT/public/icon-maskable-512.png"
cuadrado 512 "$ROOT/desktop/build/icon.png"

# .ico multi-tamaño: el de la pestaña (16/32/48) y el del .exe (hasta 256).
#
# Los generamos desde el original (no desde el PNG ya reducido) y con un
# unsharp suave: a 16px un logo con detalle se empasta, y ese realce le
# devuelve el contorno sin que se note en los tamaños grandes.
ico() { # ico <destino> <tamaños...>
  local dest="$1"; shift
  local tmp; tmp="$(mktemp -d)"
  local args=()
  for size in "$@"; do
    magick "${READ_OPTS[@]}" "$SRC" \
      -filter Lanczos -resize "${size}x${size}^" -gravity center -extent "${size}x${size}" \
      -background "$BG" -alpha remove -alpha off \
      -unsharp "0x0.6+0.7+0.02" -strip "$tmp/$size.png"
    args+=("$tmp/$size.png")
  done
  magick "${args[@]}" "$dest"
  rm -rf "$tmp"
}

ico "$ROOT/app/favicon.ico" 48 32 16
ico "$ROOT/desktop/build/icon.ico" 256 128 64 48 32 24 16

# Guardamos la imagen usada como fuente del repo, para poder rehacer todo sin
# tener que acordarse de dónde salió.
EXT="${SRC##*.}"
DEST="$ROOT/scripts/logo.${EXT,,}"
if [[ "$(readlink -f "$SRC")" != "$(readlink -f "$DEST" 2>/dev/null || echo)" ]]; then
  rm -f "$ROOT"/scripts/logo.{png,jpg,jpeg,webp,svg}
  cp "$SRC" "$DEST"
  echo "Fuente guardada en scripts/$(basename "$DEST")"
fi

echo "Íconos generados desde: $SRC (fondo $BG, maskable al ${SAFE}%)"
