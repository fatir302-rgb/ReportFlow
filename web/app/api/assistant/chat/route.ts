import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import {
  addAIConversationMessage,
  createAIChangeRequest,
  createAIConversation,
  getAIConversation,
  renameAIConversationFromFirstMessage,
} from "@/lib/db";
import { planWithAI } from "@/lib/ai-agent";
import { assistantApiKey } from "@/lib/assistant-credentials";

export async function POST(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = assistantApiKey(user.id);
  if (!apiKey) return NextResponse.json({ error: "Connect an OpenAI API key from the Assistant page." }, { status: 503 });
  try {
    const body = await request.json();
    const message = String(body.message || "").trim();
    if (!message || message.length > 6000) return NextResponse.json({ error: "Enter a message up to 6000 characters." }, { status: 400 });

    let conversationId = body.conversationId ? String(body.conversationId) : "";
    let projectId = body.projectId ? String(body.projectId) : null;
    if (conversationId) {
      const conversation = getAIConversation(user.id, conversationId);
      if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      projectId = conversation.projectId;
    } else {
      conversationId = createAIConversation({ userId: user.id, projectId });
    }

    addAIConversationMessage({ userId: user.id, conversationId, role: "user", content: message });
    renameAIConversationFromFirstMessage(user.id, conversationId, message);

    const { plan, snapshot, model } = await planWithAI({ userId: user.id, conversationId, projectId, message, apiKey });
    let proposalId: string | null = null;
    if (plan.intent === "change_request" && plan.changes.length) {
      proposalId = createAIChangeRequest({
        userId: user.id,
        conversationId,
        projectId,
        summary: plan.summary || "Proposed configuration change",
        explanation: plan.explanation,
        riskLevel: plan.riskLevel,
        plan: plan as unknown as Record<string, unknown>,
        baseSnapshot: snapshot as unknown as Record<string, unknown>,
        model,
      });
    }

    const assistantText = plan.answer || plan.explanation || plan.summary || "I couldn't interpret that request safely.";
    addAIConversationMessage({ userId: user.id, conversationId, role: "assistant", content: assistantText, proposalId });
    return NextResponse.json({ conversationId, proposalId, intent: plan.intent });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Assistant request failed" }, { status: 502 });
  }
}
