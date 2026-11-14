/** Goal: Own every locator and action on the task list page. */
import type { Locator, Page } from "@playwright/test";

export class TaskPage {
  readonly newTaskInput: Locator;
  readonly addButton: Locator;
  readonly taskList: Locator;
  readonly summary: Locator;
  readonly emptyState: Locator;
  readonly buildEnvironment: Locator;
  readonly buildCommit: Locator;

  private constructor(readonly page: Page) {
    this.newTaskInput = page.getByLabel("New task");
    this.addButton = page.getByRole("button", { name: "Add task" });
    this.taskList = page.getByRole("list", { name: "Tasks" });
    this.summary = page.getByRole("status");
    this.emptyState = page.getByText("No tasks yet");
    this.buildEnvironment = page.getByTestId("build-environment");
    this.buildCommit = page.getByTestId("build-commit");
  }

  static async open(page: Page): Promise<TaskPage> {
    await page.goto("/");
    return new TaskPage(page);
  }

  task(title: string): Locator {
    return this.taskList.getByRole("listitem").filter({ hasText: title });
  }

  checkbox(title: string): Locator {
    return this.taskList.getByRole("checkbox", { name: title, exact: true });
  }

  // fill() waits for the input to enable, which happens once the page hydrates
  async addTask(title: string) {
    await this.newTaskInput.fill(title);
    await this.addButton.click();
  }

  async completeTask(title: string) {
    await this.checkbox(title).check();
  }

  async deleteTask(title: string) {
    await this.taskList
      .getByRole("button", { name: `Delete ${title}`, exact: true })
      .click();
  }

  async reload(): Promise<TaskPage> {
    await this.page.reload();
    return new TaskPage(this.page);
  }
}
