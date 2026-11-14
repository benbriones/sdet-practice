/** Goal: Keep tasks in localStorage and expose them to React through useSyncExternalStore. */

export interface Task {
  id: string;
  title: string;
  completed: boolean;
}

// Versioned so a future change to Task can't misread old saved data
const STORAGE_KEY = "sdet-cicd-lab:tasks:v1";
// One shared empty array, since useSyncExternalStore compares snapshots by reference
const NO_TASKS: Task[] = [];

const listeners = new Set<() => void>();
let cachedTasks: Task[] | null = null;

function readStorage(): Task[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? (parsed as Task[]) : NO_TASKS;
  } catch {
    // Corrupt or blocked storage starts an empty list instead of crashing the page
    return NO_TASKS;
  }
}

function writeStorage(tasks: Task[]) {
  cachedTasks = tasks;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // Full or blocked storage still leaves the in-memory list working
  }
  listeners.forEach((listener) => listener());
}

// crypto.randomUUID is missing on plain-HTTP preview hosts, which aren't secure contexts
function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Task[] {
  cachedTasks ??= readStorage();
  return cachedTasks;
}

// The server has no localStorage, so it renders the empty list and the client fills it in
export function getServerSnapshot(): Task[] {
  return NO_TASKS;
}

export function addTask(title: string) {
  writeStorage([...getSnapshot(), { id: createId(), title, completed: false }]);
}

export function toggleTask(id: string) {
  writeStorage(
    getSnapshot().map((task) =>
      task.id === id ? { ...task, completed: !task.completed } : task,
    ),
  );
}

export function deleteTask(id: string) {
  writeStorage(getSnapshot().filter((task) => task.id !== id));
}
