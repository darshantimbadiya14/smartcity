<?php

declare(strict_types=1);

/**
 * Cache-busted asset URLs.
 *
 * Without this, browsers hold on to stale copies of style.css / ui.js /
 * three-scene.js indefinitely: the files are served with no Cache-Control
 * header, so the browser applies heuristic caching and a code change simply
 * does not reach the player until they hard-reload. Appending the file's
 * modification time makes the URL change whenever the file does, which forces
 * a fresh fetch and costs nothing when nothing has changed.
 */
function asset_version(string $relativePath): string
{
    $absolute = dirname(__DIR__) . '/' . ltrim($relativePath, '/');

    if (is_file($absolute)) {
        $mtime = @filemtime($absolute);
        if ($mtime !== false) {
            return (string) $mtime;
        }
    }

    // Unknown file: fall back to something stable so the URL stays valid.
    return '0';
}

function asset_url(string $relativePath): string
{
    return htmlspecialchars(
        $relativePath . '?v=' . asset_version($relativePath),
        ENT_QUOTES,
        'UTF-8'
    );
}
