/**
 * Transport-independent Python code simulation.
 *
 * Server proxy and browser-direct callers inject their provider runtime so the
 * prompt, provider behavior, and result parsing cannot drift between paths.
 */

import { createAnthropicMessageText } from "../streaming/anthropic";
import {
  isAnthropicProviderType,
  isGoogleProviderType,
  isOpenAIProviderType,
} from "../providers/providerTypes";
import type { ProviderConfig, ProviderRuntime } from "./runChatStream";

const CODE_SIMULATION_SYSTEM =
  "You explain and simulate Python code. You do not have a real execution sandbox. Provide ONLY the likely output, and mention uncertainty only if the result depends on external state.";

type CodeSimulationRuntime = Pick<
  ProviderRuntime,
  | "assertOutboundAllowed"
  | "createOpenAIClient"
  | "createAnthropicClient"
  | "createGoogleClient"
>;

export type CodeSimulationResult =
  { ok: true; output: string } | { ok: false; status: number; error: string };

function createSimulationPrompt(code: string): string {
  return `Please simulate the following Python code and return the likely output.
    
\`\`\`python
${code}
\`\`\`
`;
}

export async function simulateCode(
  provider: ProviderConfig,
  modelName: string,
  code: string,
  runtime: CodeSimulationRuntime,
  signal?: AbortSignal,
): Promise<CodeSimulationResult> {
  await runtime.assertOutboundAllowed(provider, signal);
  const prompt = createSimulationPrompt(code);

  if (isOpenAIProviderType(provider.type)) {
    const openai = runtime.createOpenAIClient(provider);
    const request = {
      model: modelName,
      messages: [
        { role: "system" as const, content: CODE_SIMULATION_SYSTEM },
        { role: "user" as const, content: prompt },
      ],
    };
    const response = signal
      ? await openai.chat.completions.create(request, { signal })
      : await openai.chat.completions.create(request);
    return {
      ok: true,
      output: response.choices[0]?.message?.content || "No output returned.",
    };
  }

  if (isAnthropicProviderType(provider.type)) {
    const anthropic = runtime.createAnthropicClient(provider);
    const output = await createAnthropicMessageText({
      client: anthropic,
      model: modelName,
      prompt,
      system: CODE_SIMULATION_SYSTEM,
      signal,
    });
    return { ok: true, output: output || "No output returned." };
  }

  if (isGoogleProviderType(provider.type)) {
    const google = runtime.createGoogleClient(provider);
    const response = await google.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        tools: [{ codeExecution: {} }],
        ...(signal ? { abortSignal: signal } : {}),
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts?.length) {
      return { ok: true, output: response.text || "No output." };
    }

    let output = "";
    let hasExecutionResult = false;
    for (const part of parts) {
      if (part.text && !part.text.trim().startsWith("```python")) {
        output += `${part.text}\n`;
      }
      if (part.codeExecutionResult) {
        hasExecutionResult = true;
        output += part.codeExecutionResult.output || "";
      }
    }

    return {
      ok: true,
      output: hasExecutionResult
        ? output.trim()
        : output.trim() || "No output generated.",
    };
  }

  return {
    ok: false,
    status: 400,
    error: `${provider.type} does not support code execution`,
  };
}
