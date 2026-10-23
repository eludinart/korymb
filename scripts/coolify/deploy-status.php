<?php
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use Illuminate\Support\Facades\DB;

$id = $argv[1] ?? '';
$row = DB::table('application_deployment_queues')->where('deployment_uuid', $id)->first();
if (!$row) {
    echo "missing\n";
    exit(0);
}
echo $row->status, "\n";
