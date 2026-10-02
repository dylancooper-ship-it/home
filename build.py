#!/usr/bin/env python3
"""Wrap the artifact/ fragments into the deployable pages.

The home services site. Same build, stylesheet and components as the main
site (github.com/dylancooper-ship-it/growthoperator), with its own copy.
Run after editing a source: python3 build.py

artifact/landing.html owns the stylesheet. Every other page reuses it and adds
only what is specific to itself, so the theme lives in one place and cannot
drift between pages.
"""
import pathlib
import re

SITE = "https://home.theascensionpartners.com"
NAME = "The Ascension Partners"

root = pathlib.Path(__file__).parent


def read(name):
    return (root / "artifact" / name).read_text(encoding="utf-8")


def split_style(src):
    """Return (head-before-style, css, body-after-style)."""
    a = src.index("<style>")
    b = src.index("</style>")
    return src[:a], src[a + len("<style>"):b], src[b + len("</style>"):]


landing_head, BASE_CSS, landing_body = split_style(read("landing.html"))

# Guard: unbalanced braces silently kill every rule after the break point, and
# browsers recover quietly enough that it survives a visual check.
def check_css(css, label):
    if css.count("{") != css.count("}"):
        raise SystemExit(
            f"refusing to build: CSS braces unbalanced in {label} "
            f"({css.count('{')} open, {css.count('}')} close)"
        )


check_css(BASE_CSS, "landing.html")

# Vercel Web Analytics. Served from our own origin rather than a third-party
# domain, so no blocker eats it and no cookie banner is owed: it is sampled
# server-side and sets nothing. Needs Analytics switched on for the project in
# the Vercel dashboard, otherwise this path 404s and nothing is recorded.
#
# It goes on every page from the shared template rather than page by page, so a
# page added later is measured without anyone remembering to add it.
ANALYTICS = '<script defer src="/_vercel/insights/script.js"></script>'

FONTS = """<link rel="preload" href="/fonts/OpenSauceSans-Bold.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/OpenSauceSans-SemiBold.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all';this.onload=null" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Mrs+Saint+Delafield&display=swap">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Mrs+Saint+Delafield&display=swap"></noscript>"""


def page(out_name, src_name, title, desc, path, og="og-main.png", noindex=False):
    src = read(src_name)
    if src_name == "landing.html":
        css, body = BASE_CSS, landing_body
    else:
        _, own_css, body = split_style(src)
        check_css(own_css, src_name)
        css = BASE_CSS + "\n" + own_css

    canon = SITE + path
    meta = f"""<meta name="description" content="{desc}">
<link rel="canonical" href="{canon}">
{'<meta name="robots" content="noindex,follow">' if noindex else ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="{NAME}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canon}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="{SITE}/{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{title}">
<meta name="twitter:image" content="{SITE}/{og}">"""

    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
{meta}
{FONTS}
<style>
{css}</style>
<style>html{{color-scheme:light}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
</head>
<body>
{body}
{ANALYTICS}
</body>
</html>
"""
    (root / out_name).write_text(doc, encoding="utf-8")
    print(f"{out_name:<22} {len(doc):>7,} bytes  ->  {canon}")


page(
    "index.html", "landing.html",
    f"{NAME} | Paid ads and funnels for home service companies",
    "Google, Local Services and Meta ads, the funnel they land on, speed-to-lead, "
    "follow-up and reporting, run by one team for home service companies. "
    "Measured on booked jobs, not clicks.",
    "/",
)
