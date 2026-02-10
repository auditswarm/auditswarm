import { create } from 'zustand';

interface OnboardingStore {
  currentStep: number;
  selectedJurisdiction: string | null;
  completedSteps: number[];
  nextStep: () => void;
  prevStep: () => void;
  selectJurisdiction: (code: string) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  currentStep: 0,
  selectedJurisdiction: null,
  completedSteps: [],

  nextStep: () =>
    set((state) => ({
      completedSteps: state.completedSteps.includes(state.currentStep)
        ? state.completedSteps
        : [...state.completedSteps, state.currentStep],
      currentStep: Math.min(state.currentStep + 1, 1),
    })),

  prevStep: () =>
    set((state) => ({
      currentStep: Math.max(state.currentStep - 1, 0),
    })),

  selectJurisdiction: (code) =>
    set({ selectedJurisdiction: code }),

  completeOnboarding: () =>
    set((state) => ({
      completedSteps: [...state.completedSteps, state.currentStep],
    })),

  reset: () =>
    set({ currentStep: 0, selectedJurisdiction: null, completedSteps: [] }),
}));
