<?php
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Application;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

$uuid = $argv[1] ?? '';
if ($uuid === '') {
    fwrite(STDERR, "usage: queue-by-uuid.php <uuid>\n");
    exit(1);
}
$application = Application::where('uuid', $uuid)->first();
if (!$application) {
    fwrite(STDERR, "application missing: {$uuid}\n");
    exit(1);
}
$busy = DB::table('application_deployment_queues')
    ->where('application_id', $application->id)
    ->whereIn('status', ['queued', 'in_progress'])
    ->count();
if ($busy > 0) {
    fwrite(STDERR, "deploy already running: {$busy}\n");
    exit(2);
}
$deployment_uuid = (string) Str::uuid();
queue_application_deployment($application, $deployment_uuid, 0, 'HEAD', true, false, true);
echo $deployment_uuid, "\n";
