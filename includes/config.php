<?php

declare(strict_types=1);

function loadEnv(string $path): array
{
    if (!is_file($path) || !is_readable($path)) {
        throw new RuntimeException('Environment file not found.');
    }

    $values = [];
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

    foreach ($lines as $line) {
        $line = trim($line);

        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }

        if (!str_contains($line, '=')) {
            continue;
        }

        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);

        $value = trim($value, "\"'");

        $values[$key] = $value;
    }

    return $values;
}

$envPath = dirname(__DIR__) . '/.env';
$env = loadEnv($envPath);

define('DB_HOST', $env['DB_HOST'] ?? '');
define('DB_NAME', $env['DB_NAME'] ?? '');
define('DB_USER', $env['DB_USER'] ?? '');
define('DB_PASS', $env['DB_PASS'] ?? '');
