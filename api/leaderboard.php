<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/session.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Method not allowed.', 405);
    exit;
}

$userId = current_user_id();

if ($userId === null) {
    json_error('Not authenticated.', 401);
    exit;
}

try {
    $pdo = getDbConnection();

    // Admin accounts are staff, not players — their cities stay off the board.
    $topStmt = $pdo->query(
        'SELECT c.id, c.name, c.score, c.population, u.name AS owner_name
         FROM cities c
         INNER JOIN users u ON u.id = c.user_id
         WHERE u.is_admin = 0
         ORDER BY c.score DESC, c.id ASC
         LIMIT 20'
    );
    $topRows = $topStmt->fetchAll();

    $myCityStmt = $pdo->prepare(
        'SELECT c.id, c.name, c.score, c.population, u.name AS owner_name
         FROM cities c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.user_id = :user_id
         LIMIT 1'
    );
    $myCityStmt->execute(['user_id' => $userId]);
    $myCity = $myCityStmt->fetch();

    $leaderboard = [];
    $myCityInTop = false;

    foreach ($topRows as $index => $row) {
        $isYou = $myCity !== false && (int) $row['id'] === (int) $myCity['id'];
        if ($isYou) {
            $myCityInTop = true;
        }

        $leaderboard[] = [
            'rank' => $index + 1,
            'city_name' => $row['name'],
            'owner_name' => $row['owner_name'],
            'score' => (int) $row['score'],
            'population' => (int) $row['population'],
            'is_you' => $isYou,
        ];
    }

    if ($myCity !== false && !$myCityInTop) {
        $rankStmt = $pdo->prepare(
            'SELECT COUNT(*) FROM cities c
             INNER JOIN users u ON u.id = c.user_id
             WHERE u.is_admin = 0 AND c.score > :score'
        );
        $rankStmt->execute(['score' => $myCity['score']]);
        $myRank = (int) $rankStmt->fetchColumn() + 1;

        $leaderboard[] = [
            'rank' => $myRank,
            'city_name' => $myCity['name'],
            'owner_name' => $myCity['owner_name'],
            'score' => (int) $myCity['score'],
            'population' => (int) $myCity['population'],
            'is_you' => true,
        ];
    }

    json_success([
        'leaderboard' => $leaderboard,
    ]);
} catch (Throwable $e) {
    error_log('Fetching leaderboard failed: ' . $e->getMessage());
    json_error('Unable to load leaderboard.', 500);
}
