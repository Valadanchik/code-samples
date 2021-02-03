<?php

// ...

public function add(AddTaskRequest $request)
{
    // extract dataset value from input
    $dataset = $this->taskService->extractDataset($request->get('dataset'));

    // create task instance in "tasks" table and return "id"
    $task_id = $this->taskService->create($dataset);

    $filename = $this->taskService->getTaskFilename($dataset);

    $batch = Bus::chain([
        new DownloadJsonJob($task_id, $dataset, $filename),
        $store_batch = function () use ($task_id, $filename) {
            $concurrent_batch_name = $this->taskService->getBatchName('store', $task_id);

            $products_count_approx = $this->taskService->productsApproxCount($filename);
            $store_chunks = $this->taskService->getStoreChunks($products_count_approx);

            // get ready for storing items concurrent job instances
            $store_items_jobs_chunk_intervals = [];
            for ($j = 0; $j < $store_chunks['number']; $j++) {
                $store_items_jobs_chunk_intervals[] = new StoreItemsJob($task_id, $filename, [$j * $store_chunks['count'], ($j + 1) * $store_chunks['count'] - 1]);
            }

            Bus::batch($store_items_jobs_chunk_intervals)
                ->then(function (Batch $concurrent_batch) use ($task_id) {
                    info("TASK " . $task_id . ": StoreItemsJob jobs done.");
                })
                ->catch(function (Batch $concurrent_batch, Throwable $e) use ($task_id) {
                    info("TASK" . $task_id . ": StoreItemsJob error! - " . $e->getMessage());
                    $taskService = new TaskService();
                    $task = $taskService->getTaskById($task_id);
                    $taskService->updateTaskFields($task, [
                        'status' => Task::LOCKED,
                        'message' => "Process failed on storing!",
                    ]);
                })
                ->finally(function (Batch $concurrent_batch) use ($task_id) {
                    info("TASK" . $task_id . ": StoreItemsJob batch has finished executing.");
                    $taskService = new TaskService();
                    $task = $taskService->getTaskById($task_id);
                    $taskService->updateTaskFields($task, [
                        'status' => Task::ACTIVE,
                        'message' => "The batch has finished executing.",
                    ]);
                })
                ->name($concurrent_batch_name)
                ->dispatch();
        },
    ])->dispatch();

    return response()->json([
        'success' => true,
        'task_id' => $task_id,
        'message' => "Task successfully run.",
    ]);
}

// ...
