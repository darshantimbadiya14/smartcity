<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/economy.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed.', 405);
    exit;
}

$userId = current_user_id();

if ($userId === null) {
    json_error('Not authenticated.', 401);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    json_error('Invalid JSON body.', 400);
    exit;
}

try {
    $pdo = getDbConnection();

    $cityStmt = $pdo->prepare('SELECT id, name, tax_rate FROM cities WHERE user_id = :user_id LIMIT 1');
    $cityStmt->execute(['user_id' => $userId]);
    $city = $cityStmt->fetch();

    if ($city === false) {
        json_error('City not found. Load your city first.', 404);
        exit;
    }

    $cityId = (int) $city['id'];
    $cityName = $city['name'];
    $taxRate = (float) $city['tax_rate'];

    if (array_key_exists('name', $input)) {
        $candidate = is_string($input['name']) ? trim($input['name']) : '';

        if ($candidate === '') {
            json_error('City name cannot be empty.', 422);
            exit;
        }
        if (mb_strlen($candidate) > 100) {
            json_error('City name must be 100 characters or fewer.', 422);
            exit;
        }

        $cityName = $candidate;
    }

    if (array_key_exists('tax_rate', $input)) {
        $candidate = filter_var($input['tax_rate'], FILTER_VALIDATE_FLOAT);

        if ($candidate === false) {
            json_error('Tax rate must be a number.', 422);
            exit;
        }
        if ($candidate < TAX_RATE_MIN || $candidate > TAX_RATE_MAX) {
            json_error(
                'Tax rate must be between ' . round(TAX_RATE_MIN * 100) . '% and ' . round(TAX_RATE_MAX * 100) . '%.',
                422
            );
            exit;
        }

        $taxRate = clampTaxRate($candidate);
    }

    $update = $pdo->prepare('UPDATE cities SET name = :name, tax_rate = :tax_rate WHERE id = :id');
    $update->execute(['name' => $cityName, 'tax_rate' => $taxRate, 'id' => $cityId]);

    json_success([
        'name' => $cityName,
        'tax_rate' => $taxRate,
        'tax_label' => taxRateLabel($taxRate),
    ], 'City settings saved.');
} catch (Throwable $e) {
    error_log('City settings update failed: ' . $e->getMessage());
    json_error('Unable to save city settings.', 500);
}
