import { create } from "zustand";
import { normalizeImagePreviewState } from "@/lib/utils/imagePreview";

export interface PreviewImage {
  url: string;
  alt?: string;
  description?: string;
}

interface UIState {
  imagePreview: {
    isOpen: boolean;
    images: PreviewImage[];
    currentIndex: number;
  };
  openImagePreview: (
    images: PreviewImage[],
    startIndex?: number,
    registeredImageUrls?: readonly string[],
  ) => void;
  closeImagePreview: () => void;
  setImagePreviewIndex: (index: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  imagePreview: {
    isOpen: false,
    images: [],
    currentIndex: 0,
  },
  openImagePreview: (images, startIndex = 0, registeredImageUrls = []) => {
    const preview = normalizeImagePreviewState(
      images,
      startIndex,
      registeredImageUrls,
    );

    set({
      imagePreview: preview
        ? {
            isOpen: true,
            images: preview.images,
            currentIndex: preview.currentIndex,
          }
        : {
            isOpen: false,
            images: [],
            currentIndex: 0,
          },
    });
  },
  closeImagePreview: () =>
    set((state) => ({
      imagePreview: {
        ...state.imagePreview,
        isOpen: false,
      },
    })),
  setImagePreviewIndex: (index) =>
    set((state) => ({
      imagePreview: {
        ...state.imagePreview,
        currentIndex:
          state.imagePreview.images.length > 0
            ? Math.min(
                Math.max(0, Math.floor(index)),
                state.imagePreview.images.length - 1,
              )
            : 0,
      },
    })),
}));
