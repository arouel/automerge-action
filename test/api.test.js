const api = require("../lib/api");
const { createConfig } = require("../lib/common");
const { pullRequest } = require("./common");

let octokit;

test("forked PR check_suite/check_run updates are handled", async () => {
  // GIVEN
  const head_sha = "1234abcd";
  const pr = pullRequest();
  pr.labels = [{ name: "automerge" }];
  pr.head.sha = head_sha;

  const config = createConfig({});

  let merged = false;
  octokit = {
    pulls: {
      list: jest.fn(() => ({ data: [pr] })),
      merge: jest.fn(() => (merged = true)),
      listReviews: jest.fn(() => ({ data: [] }))
    }
  };

  const event = {
    action: "completed",
    repository: { owner: { login: "other-username" }, name: "repository" },
    check_suite: { conclusion: "success", head_sha, pull_requests: [] }
  };

  // WHEN
  await api.executeGitHubAction({ config, octokit }, "check_suite", event);
  expect(merged).toEqual(true);
});

test("only merge PRs with required approvals", async () => {
  // GIVEN
  const head_sha = "1234abcd";
  const pr = pullRequest();
  pr.labels = [{ name: "automerge" }];
  pr.head.sha = head_sha;

  const config = createConfig({});
  config.mergeRequiredApprovals = 2; // let's only merge, if there are two independent approvals

  let merged = false;
  octokit = {
    pulls: {
      list: jest.fn(() => ({ data: [pr] })),
      merge: jest.fn(() => (merged = true)),
      listReviews: Symbol("listReviews")
    },
    paginate: jest.fn(() => [])
  };

  const event = {
    action: "completed",
    repository: { owner: { login: "other-username" }, name: "repository" },
    check_suite: { conclusion: "success", head_sha, pull_requests: [] }
  };

  // WHEN
  await api.executeGitHubAction({ config, octokit }, "check_suite", event);
  expect(merged).toEqual(false); // if there's no approval, it should fail

  merged = false;
  octokit.paginate.mockReturnValueOnce([
    { state: "CHANGES_REQUESTED", user: { login: "approval_user" } },
    { state: "APPROVED", user: { login: "approval_user" } },
    { state: "APPROVED", user: { login: "approval_user2" } }
  ]);

  // WHEN
  await api.executeGitHubAction({ config, octokit }, "check_suite", event);
  expect(merged).toEqual(true); // if there are two approvals, it should succeed

  merged = false;
  octokit.paginate.mockReturnValueOnce([
    { state: "APPROVED", user: { login: "approval_user" } },
    { state: "APPROVED", user: { login: "approval_user" } }
  ]);

  // WHEN a user has given
  await api.executeGitHubAction({ config, octokit }, "check_suite", event);
  expect(merged).toEqual(false); // if there are only two approvals from the same user, it should fail

  merged = false;
  octokit.pulls.listReviews.mockReturnValueOnce({
    data: [
      { id: 1, state: "APPROVED", user: { id: 123 } },
      { id: 2, state: "CHANGES_REQUESTED", user: { id: 123 } },
      { id: 3, state: "APPROVED", user: { id: 124 } }
    ]
  });

  // WHEN
  await api.executeGitHubAction({ config, octokit }, "check_suite", event);
  expect(merged).toEqual(false); // if there are two approvals but a change request afterwards, it should fail
});
