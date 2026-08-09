<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function getDbConnection(): PDO
{
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    try {
        return new PDO($dsn, DB_USER, DB_PASS, $options);
    } catch (PDOException $e) {
        error_log('Database connection failed: ' . $e->getMessage());
        // TEMPORARY DEBUG: full exception detail goes only to a local, gitignored file.
        file_put_contents(
            __DIR__ . '/../debug.log',
            '[' . date('Y-m-d H:i:s') . '] ' . $e->getMessage() . PHP_EOL,
            FILE_APPEND
        );
        throw new RuntimeException('Database connection failed.');
    }
}
