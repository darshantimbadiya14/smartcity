<?php

declare(strict_types=1);

function json_success(array $data = [], string $message = ''): void
{
    http_response_code(200);
    header('Content-Type: application/json');

    echo json_encode([
        'status' => 'success',
        'message' => $message,
        'data' => $data,
    ]);
}

function json_error(string $message, int $httpStatusCode = 400): void
{
    http_response_code($httpStatusCode);
    header('Content-Type: application/json');

    echo json_encode([
        'status' => 'error',
        'message' => $message,
    ]);
}
