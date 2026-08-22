/**
 * 辅助功能处理器（服务端）
 * 用于标题生成、相关问题、RAG 查询等
 *
 * 提示词与解析逻辑位于同构的 `lib/chat/auxiliaryGeneration`，
 * 这里只负责绑定服务端的模型调用实现。
 */

import type { Message } from "@/types";
import { handleSimpleGeneration } from "./chat-handler";
import { ProviderConfig } from "../providers/base";
import {
  generateRAGQueriesWith,
  generateRelatedQuestionsWith,
  generateTitleWith,
} from "../chat/auxiliaryGeneration";

/**
 * 生成聊天标题
 */
export function generateTitle(
  provider: ProviderConfig,
  modelName: string,
  history: Message[],
  signal?: AbortSignal,
): Promise<string> {
  return generateTitleWith(
    handleSimpleGeneration,
    provider,
    modelName,
    history,
    signal,
  );
}

/**
 * 生成相关问题
 */
export function generateRelatedQuestions(
  provider: ProviderConfig,
  modelName: string,
  history: Message[],
  signal?: AbortSignal,
): Promise<string[]> {
  return generateRelatedQuestionsWith(
    handleSimpleGeneration,
    provider,
    modelName,
    history,
    signal,
  );
}

/**
 * 生成 RAG 查询
 */
export function generateRAGQueries(
  provider: ProviderConfig,
  modelName: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return generateRAGQueriesWith(
    handleSimpleGeneration,
    provider,
    modelName,
    userMessage,
    signal,
  );
}
