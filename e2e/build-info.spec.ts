/** Goal: Prove the environment under test is running the commit CI expects, not a stale build. */
import { expect, test } from "@playwright/test";
import { TaskPage } from "./pages/task-page";

// CI passes the PR head SHA; local runs fall back to the app's "dev" default
const expectedCommitSha = process.env.EXPECTED_COMMIT_SHA ?? "dev";

test("serves the expected commit", async ({ page, request }) => {
  //--------------------------------
  // Arrange:
  //--------------------------------
  // Open the app so the build badge renders
  const taskPage = await TaskPage.open(page);

  //--------------------------------
  // Act:
  //--------------------------------
  // Ask the health check which commit this server is running
  const health = await request.get("/api/health");

  //--------------------------------
  // Assert:
  //--------------------------------
  // Assert the health check reports the expected commit
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({
    status: "ok",
    commitSha: expectedCommitSha,
  });

  // Assert the badge a person would read shows the same short SHA
  await expect(taskPage.buildCommit).toHaveText(expectedCommitSha.slice(0, 7));
});
