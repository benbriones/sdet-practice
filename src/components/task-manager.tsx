"use client";

/** Goal: Add, complete and delete tasks saved in this browser. */
import { useState, useSyncExternalStore, type FormEvent } from "react";
import {
  addTask,
  deleteTask,
  getServerSnapshot,
  getSnapshot,
  subscribe,
  toggleTask,
} from "@/lib/task-store";

const subscribeNever = () => () => {};

// False in server HTML, true once React hydrates, so the form can't submit before handlers attach
function useHydrated() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function TaskManager() {
  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useHydrated();
  const [title, setTitle] = useState("");
  const remaining = tasks.filter((task) => !task.completed).length;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    addTask(trimmed);
    setTitle("");
  }

  return (
    <section className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="new-task" className="sr-only">
          New task
        </label>
        <input
          id="new-task"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          disabled={!hydrated}
          autoComplete="off"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={!hydrated || !title.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add task
        </button>
      </form>

      {tasks.length === 0 ? (
        <p className="text-zinc-500">No tasks yet. Add one above.</p>
      ) : (
        <>
          <p role="status" className="text-sm text-zinc-500">
            {remaining} of {tasks.length} remaining
          </p>
          <ul
            aria-label="Tasks"
            className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
          >
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  id={`task-${task.id}`}
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleTask(task.id)}
                  className="size-4"
                />
                <label
                  htmlFor={`task-${task.id}`}
                  className={`flex-1 ${task.completed ? "text-zinc-400 line-through" : ""}`}
                >
                  {task.title}
                </label>
                <button
                  type="button"
                  aria-label={`Delete ${task.title}`}
                  onClick={() => deleteTask(task.id)}
                  className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
