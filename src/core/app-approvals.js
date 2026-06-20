function createAppApprovals(app, helpers = {}) {
  return {
    handleApprovalRequested: (event) => handleApprovalRequested(app, helpers, event),
  };
}

async function handleApprovalRequested(app, helpers, event) {
  if (event?.type !== "runtime.approval.requested") {
    return;
  }

  const sessionStore = app.runtimeAdapter.getSessionStore();
  const linked = sessionStore.findBindingForThreadId(event.payload.threadId);
  if (!linked?.workspaceRoot) {
    return;
  }

  const allowlist = sessionStore.getApprovalCommandAllowlistForWorkspace(linked.workspaceRoot);
  const shouldAutoApprove = helpers.isAutoApprovedStateDirOperation(event.payload, app.config)
    || helpers.matchesBuiltInCommandPrefix(event.payload.commandTokens)
    || helpers.matchesCommandPrefix(event.payload.commandTokens, allowlist);

  if (!shouldAutoApprove) {
    const promptState = sessionStore.getApprovalPromptState(event.payload.threadId);
    const promptSignature = helpers.buildApprovalPromptSignature(event.payload);
    if (promptState?.signature && promptState.signature === promptSignature) {
      sessionStore.rememberApprovalPrompt(event.payload.threadId, event.payload.requestId, promptSignature);
      console.log(
        `[cyberboss] approval prompt deduped thread=${event.payload.threadId} requestId=${event.payload.requestId}`
      );
      return;
    }

    sessionStore.rememberApprovalPrompt(event.payload.threadId, event.payload.requestId, promptSignature);
    await app.sendApprovalPrompt({
      bindingKey: linked.bindingKey,
      approval: event.payload,
    }).catch((error) => {
      sessionStore.clearApprovalPrompt(event.payload.threadId);
      throw error;
    });
    return;
  }

  const approvalResponse = helpers.buildApprovalResponsePayload(event.payload, "yes");
  if (!approvalResponse) {
    sessionStore.clearApprovalPrompt(event.payload.threadId);
    await app.sendApprovalPrompt({
      bindingKey: linked.bindingKey,
      approval: event.payload,
    }).catch(() => {});
    return;
  }

  await app.runtimeAdapter.respondApproval(approvalResponse).catch(() => {});
  app.threadStateStore.resolveApproval(event.payload.threadId, "running");
}

module.exports = {
  createAppApprovals,
};
