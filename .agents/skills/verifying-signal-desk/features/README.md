# Feature map

- [Cards](cards.md): reviewed answers, unresolved evidence, handoffs, unsent and stale drafts.
- [Conversation](conversation.md): reading hierarchy, literal evidence and responsive text.
- [Chat workspace](chat-workspace.md): popup windows, email draft editing and local messages.
- [Municipal workspace](municipal-workspace.md): department page, acquisition and sale chat.
- [Shell and primitives](shell-and-primitives.md): dispatch layout, palette, actions and forms.
- [Sales workflow](sales-workflow.md): authorization, evidence review, persistence and draft safety.
- [MCP tokens](mcp-tokens.md): local token management and the MCP client.

`scripts/verify-ui.mjs` lists every Storybook story and fails when one is added or removed
without a matching check, so update its `stories` table alongside this map.
Changes in shared card or reading files affect all variants, not just the default story.
This map covers the current slice, not every future tool integration or provider path.
