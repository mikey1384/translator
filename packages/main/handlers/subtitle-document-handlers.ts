import type { IpcMainInvokeEvent } from 'electron';
import type {
  DetachSubtitleDocumentSourceOptions,
  DetachSubtitleDocumentSourceResult,
  FindSubtitleDocumentForFileOptions,
  FindSubtitleDocumentForFileResult,
  FindSubtitleDocumentForSourceOptions,
  FindSubtitleDocumentForSourceResult,
  ReadSubtitleDocumentOptions,
  ReadSubtitleDocumentResult,
  SaveSubtitleDocumentRecordOptions,
  SaveSubtitleDocumentRecordResult,
} from '@shared-types/app';
import {
  detachSubtitleDocumentSource,
  findSubtitleDocumentForFile,
  findSubtitleDocumentForSource,
  readSubtitleDocument,
  saveSubtitleDocumentRecord,
} from '../services/subtitle-documents.js';

export async function handleSaveSubtitleDocumentRecord(
  _event: IpcMainInvokeEvent,
  options: SaveSubtitleDocumentRecordOptions
): Promise<SaveSubtitleDocumentRecordResult> {
  try {
    const document = await saveSubtitleDocumentRecord(options || ({} as any));
    return { success: true, document };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}

export async function handleReadSubtitleDocument(
  _event: IpcMainInvokeEvent,
  options: ReadSubtitleDocumentOptions
): Promise<ReadSubtitleDocumentResult> {
  try {
    const result = await readSubtitleDocument(options);
    if (!result) {
      return { success: false, error: 'Subtitle document not found.' };
    }
    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}

export async function handleFindSubtitleDocumentForFile(
  _event: IpcMainInvokeEvent,
  options: FindSubtitleDocumentForFileOptions
): Promise<FindSubtitleDocumentForFileResult> {
  try {
    const result = await findSubtitleDocumentForFile(options);
    return {
      success: true,
      found: Boolean(result),
      document: result?.document,
      segments: result?.segments,
      fileMode: result?.fileMode,
      fileRole: result?.fileRole,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}

export async function handleFindSubtitleDocumentForSource(
  _event: IpcMainInvokeEvent,
  options: FindSubtitleDocumentForSourceOptions
): Promise<FindSubtitleDocumentForSourceResult> {
  try {
    const result = await findSubtitleDocumentForSource(options);
    return {
      success: true,
      found: Boolean(result),
      document: result?.document,
      segments: result?.segments,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}

export async function handleDetachSubtitleDocumentSource(
  _event: IpcMainInvokeEvent,
  options: DetachSubtitleDocumentSourceOptions
): Promise<DetachSubtitleDocumentSourceResult> {
  try {
    const document = await detachSubtitleDocumentSource(options);
    return {
      success: true,
      updated: Boolean(document),
      document: document ?? undefined,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}
