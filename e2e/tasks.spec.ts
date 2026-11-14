/** Goal: Cover adding, completing, deleting and persisting tasks in localStorage. */
import { expect, test } from "@playwright/test";
import { TaskPage } from "./pages/task-page";

const testData = {
  docker: "Write the Dockerfile",
  workflow: "Add the CI workflow",
  cluster: "Create the kind cluster",
  argo: "Install Argo CD",
};

test("adds a task to the list", async ({ page }) => {
  //--------------------------------
  // Arrange:
  //--------------------------------
  // Open the app with an empty task list
  const taskPage = await TaskPage.open(page);

  //--------------------------------
  // Act:
  //--------------------------------
  // Add one task through the form
  await taskPage.addTask(testData.docker);

  //--------------------------------
  // Assert:
  //--------------------------------
  // Assert the task shows as open and the form resets for the next one
  await expect(taskPage.task(testData.docker)).toBeVisible();
  await expect(taskPage.checkbox(testData.docker)).not.toBeChecked();
  await expect(taskPage.newTaskInput).toHaveValue("");
  await expect(taskPage.summary).toHaveText("1 of 1 remaining");
});

test("marks a task complete", async ({ page }) => {
  //--------------------------------
  // Arrange:
  //--------------------------------
  // Start with two open tasks
  const taskPage = await TaskPage.open(page);
  await taskPage.addTask(testData.workflow);
  await taskPage.addTask(testData.cluster);

  //--------------------------------
  // Act:
  //--------------------------------
  // Complete only the first task
  await taskPage.completeTask(testData.workflow);

  //--------------------------------
  // Assert:
  //--------------------------------
  // Assert only the completed task is checked and the count drops by one
  await expect(taskPage.checkbox(testData.workflow)).toBeChecked();
  await expect(taskPage.checkbox(testData.cluster)).not.toBeChecked();
  await expect(taskPage.summary).toHaveText("1 of 2 remaining");
});

test("deletes a task", async ({ page }) => {
  //--------------------------------
  // Arrange:
  //--------------------------------
  // Start with one task in the list
  const taskPage = await TaskPage.open(page);
  await taskPage.addTask(testData.argo);

  //--------------------------------
  // Act:
  //--------------------------------
  // Delete that task
  await taskPage.deleteTask(testData.argo);

  //--------------------------------
  // Assert:
  //--------------------------------
  // Assert the list is gone and the empty state is back
  await expect(taskPage.taskList).toBeHidden();
  await expect(taskPage.emptyState).toBeVisible();
});

test("keeps tasks after a page reload", async ({ page }) => {
  //--------------------------------
  // Arrange:
  //--------------------------------
  // Save one completed task and one open task to localStorage
  let taskPage = await TaskPage.open(page);
  await taskPage.addTask(testData.docker);
  await taskPage.addTask(testData.workflow);
  await taskPage.completeTask(testData.docker);

  //--------------------------------
  // Act:
  //--------------------------------
  // Reload, so the list must come back from storage
  taskPage = await taskPage.reload();

  //--------------------------------
  // Assert:
  //--------------------------------
  // Assert both tasks and their completed state survived the reload
  await expect(taskPage.checkbox(testData.docker)).toBeChecked();
  await expect(taskPage.checkbox(testData.workflow)).not.toBeChecked();
  await expect(taskPage.summary).toHaveText("1 of 2 remaining");
});
