<?php

declare(strict_types=1);

// The dashboard moved to admin/index.php when the full admin panel was built.
// Kept so older bookmarks and links still land in the right place.
header('Location: index.php', true, 301);
exit;
