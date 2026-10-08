#!/bin/sh
# Builds the app icons, Apple TV layered icon, Top Shelf images and launch logo from the brand
# masters in ../brand (copied from the Portico brand set; do not redraw or recolour them).
# Needs ImageMagick (`magick`). Run from anywhere: sh apps/native/scripts/make-icons.sh [apple|android]
# (no argument writes both).
set -e
HERE="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BRAND="$HERE/brand"
NAVY_A="#15356A"; NAVY_B="#0A1830"   # the brand's diagonal navy, top-left to bottom-right
TARGET="${1:-all}"

gradient() { magick -size "$1x$2" -define gradient:angle=135 "gradient:$NAVY_A-$NAVY_B" -alpha off "$3"; }
json() { printf '%s\n' "$2" > "$1/Contents.json"; }
INFO='"info" : {"author" : "xcode", "version" : 1}'

# --- Android: adaptive icon, pre-adaptive icons, the television banner, the launch logo ------
# The adaptive icon's background is the navy gradient as a drawable (res/drawable/
# ic_launcher_background.xml); only its foreground is a bitmap. The canvas is 108dp, of which a
# launcher shows the middle 72dp under its own mask, so the mark is drawn at 80dp: inside the
# 66dp safe circle, with the artwork's own rounded corners outside every mask.
android_icons() {
  RES="$HERE/android/app/src/main/res"
  for D in "mdpi 1" "hdpi 1.5" "xhdpi 2" "xxhdpi 3" "xxxhdpi 4"; do set -- $D
    M="$RES/mipmap-$1"; mkdir -p "$M"
    CANVAS="$(echo "108 * $2 / 1" | bc)"; MARK="$(echo "80 * $2 / 1" | bc)"; LEGACY="$(echo "48 * $2 / 1" | bc)"
    magick -size "${CANVAS}x${CANVAS}" xc:none \( "$BRAND/appicon-1024.png" -resize "${MARK}x${MARK}" \) -gravity center -composite "$M/ic_launcher_foreground.png"
    # Android 7 (before adaptive icons): the finished icon, as iOS has it.
    gradient "$LEGACY" "$LEGACY" "$M/bg.png"
    magick "$M/bg.png" \( "$BRAND/appicon-1024.png" -resize "${LEGACY}x${LEGACY}" \) -composite "$M/ic_launcher.png"; rm "$M/bg.png"
  done
  # Android TV and Fire TV home screens: 320x180dp, the wordmark on the navy (the tvOS icon's layers, flattened).
  B="$RES/drawable-xhdpi"; mkdir -p "$B"
  gradient 640 360 "$B/bg.png"
  magick "$B/bg.png" \( "$BRAND/wordmark-white-4096w.png" -resize "$(( 640 * 74 / 100 ))x" \) -gravity center -composite -alpha off "$B/tv_banner.png"; rm "$B/bg.png"
  # Launch logo: the white wordmark, centred by res/drawable/launch_screen.xml (200dp wide).
  for D in "mdpi 1" "hdpi 1.5" "xhdpi 2" "xxhdpi 3" "xxxhdpi 4"; do set -- $D
    L="$RES/drawable-$1"; mkdir -p "$L"
    magick "$BRAND/wordmark-white-4096w.png" -resize "$(echo "200 * $2 / 1" | bc)x" "$L/launch_logo.png"
  done
}
if [ "$TARGET" != apple ]; then android_icons; fi
if [ "$TARGET" = android ]; then echo "icons written"; exit 0; fi

# --- iOS: one opaque 1024 icon (the system masks it; transparency is rejected) -------------
IOS="$HERE/ios/Portico/Images.xcassets/AppIcon.appiconset"
rm -rf "$IOS"; mkdir -p "$IOS"
gradient 1024 1024 "$IOS/bg.png"
magick "$IOS/bg.png" "$BRAND/appicon-1024.png" -composite -alpha off "$IOS/AppIcon-1024.png"; rm "$IOS/bg.png"
json "$IOS" "{\"images\" : [{\"filename\" : \"AppIcon-1024.png\", \"idiom\" : \"universal\", \"platform\" : \"ios\", \"size\" : \"1024x1024\"}], $INFO}"

# --- launch logo, both platforms: the white wordmark, large and centred by the storyboard ---
for P in ios tvos; do
  L="$HERE/$P/Portico/Images.xcassets/LaunchLogo.imageset"; rm -rf "$L"; mkdir -p "$L"
  magick "$BRAND/wordmark-white-4096w.png" -resize 1200x "$L/LaunchLogo@2x.png"
  magick "$BRAND/wordmark-white-4096w.png" -resize 1800x "$L/LaunchLogo@3x.png"
  magick "$BRAND/wordmark-white-4096w.png" -resize 600x "$L/LaunchLogo.png"
  json "$L" "{\"images\" : [{\"filename\" : \"LaunchLogo.png\", \"idiom\" : \"universal\", \"scale\" : \"1x\"}, {\"filename\" : \"LaunchLogo@2x.png\", \"idiom\" : \"universal\", \"scale\" : \"2x\"}, {\"filename\" : \"LaunchLogo@3x.png\", \"idiom\" : \"universal\", \"scale\" : \"3x\"}], $INFO}"
done

# --- tvOS: a layered icon (navy behind, wordmark in front, so it lifts on focus) ------------
TV="$HERE/tvos/Portico/Images.xcassets"
rm -rf "$TV/AppIcon.appiconset" "$TV/App Icon & Top Shelf Image.brandassets"
A="$TV/App Icon & Top Shelf Image.brandassets"; mkdir -p "$A"
layer() { # stack-dir layer-name file@1x [file@2x]
  D="$1/$2.imagestacklayer"; mkdir -p "$D/Content.imageset"; json "$D" "{$INFO}"
  if [ -n "$4" ]; then
    cp "$3" "$D/Content.imageset/$2.png"; cp "$4" "$D/Content.imageset/$2@2x.png"
    json "$D/Content.imageset" "{\"images\" : [{\"filename\" : \"$2.png\", \"idiom\" : \"tv\", \"scale\" : \"1x\"}, {\"filename\" : \"$2@2x.png\", \"idiom\" : \"tv\", \"scale\" : \"2x\"}], $INFO}"
  else
    cp "$3" "$D/Content.imageset/$2.png"
    json "$D/Content.imageset" "{\"images\" : [{\"filename\" : \"$2.png\", \"idiom\" : \"tv\"}], $INFO}"
  fi
}
front() { magick -size "$1x$2" xc:none \( "$BRAND/wordmark-white-4096w.png" -resize "$(( $1 * 74 / 100 ))x" \) -gravity center -composite "$3"; }
T="$(mktemp -d)"
for S in "400 240" "800 480" "1280 768"; do set -- $S; gradient "$1" "$2" "$T/back-$1.png"; front "$1" "$2" "$T/front-$1.png"; done
STACK="$A/App Icon.imagestack"; mkdir -p "$STACK"
json "$STACK" "{\"layers\" : [{\"filename\" : \"Front.imagestacklayer\"}, {\"filename\" : \"Back.imagestacklayer\"}], $INFO}"
layer "$STACK" Front "$T/front-400.png" "$T/front-800.png"; layer "$STACK" Back "$T/back-400.png" "$T/back-800.png"
STORE="$A/App Icon - App Store.imagestack"; mkdir -p "$STORE"
json "$STORE" "{\"layers\" : [{\"filename\" : \"Front.imagestacklayer\"}, {\"filename\" : \"Back.imagestacklayer\"}], $INFO}"
layer "$STORE" Front "$T/front-1280.png"; layer "$STORE" Back "$T/back-1280.png"
shelf() { # name file@1x file@2x
  D="$A/$1.imageset"; mkdir -p "$D"; cp "$2" "$D/shelf.png"; cp "$3" "$D/shelf@2x.png"
  json "$D" "{\"images\" : [{\"filename\" : \"shelf.png\", \"idiom\" : \"tv\", \"scale\" : \"1x\"}, {\"filename\" : \"shelf@2x.png\", \"idiom\" : \"tv\", \"scale\" : \"2x\"}], $INFO}"
}
shelf "Top Shelf Image" "$BRAND/portico-tv-topshelf-1920x720.png" "$BRAND/portico-tv-topshelf-3840x1440.png"
shelf "Top Shelf Image Wide" "$BRAND/portico-tv-topshelf-wide-2320x720.png" "$BRAND/portico-tv-topshelf-wide-4640x1440.png"
json "$A" "{\"assets\" : [{\"filename\" : \"App Icon.imagestack\", \"idiom\" : \"tv\", \"role\" : \"primary-app-icon\", \"size\" : \"400x240\"}, {\"filename\" : \"App Icon - App Store.imagestack\", \"idiom\" : \"tv\", \"role\" : \"primary-app-icon\", \"size\" : \"1280x768\"}, {\"filename\" : \"Top Shelf Image.imageset\", \"idiom\" : \"tv\", \"role\" : \"top-shelf-image\", \"size\" : \"1920x720\"}, {\"filename\" : \"Top Shelf Image Wide.imageset\", \"idiom\" : \"tv\", \"role\" : \"top-shelf-image-wide\", \"size\" : \"2320x720\"}], $INFO}"
rm -rf "$T"
echo "icons written"
