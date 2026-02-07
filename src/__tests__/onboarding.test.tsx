import React, { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CauseSelector } from '@/components/onboarding/CauseSelector';
import { locationSchema, causesSchema, onboardingSchema } from '@/lib/validations/onboarding';

// Suppress vi unused variable warning
void vi;

// Mock causes data
const mockCauses = [
  { id: '1', name: 'Climate & Environment', icon: '🌍', color: '#0ea5e9', description: 'Climate action' },
  { id: '2', name: 'Education', icon: '📚', color: '#3b82f6', description: 'Public education' },
  { id: '3', name: 'Healthcare', icon: '🏥', color: '#ef4444', description: 'Healthcare access' },
  { id: '4', name: 'Housing', icon: '🏠', color: '#f97316', description: 'Affordable housing' },
  { id: '5', name: 'Criminal Justice', icon: '⚖️', color: '#0ea5e9', description: 'Justice reform' },
];

// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('Location Schema Validation', () => {
  it('should validate a valid US zip code', () => {
    const result = locationSchema.safeParse({
      zipCode: '90210',
      streetAddress: '123 Main St',
    });
    expect(result.success).toBe(true);
  });

  it('should validate a zip+4 format', () => {
    const result = locationSchema.safeParse({
      zipCode: '90210-1234',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid zip code', () => {
    const result = locationSchema.safeParse({
      zipCode: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a short zip code', () => {
    const result = locationSchema.safeParse({
      zipCode: '123',
    });
    expect(result.success).toBe(false);
  });

  it('should allow optional street address', () => {
    const result = locationSchema.safeParse({
      zipCode: '90210',
    });
    expect(result.success).toBe(true);
  });
});

describe('Causes Schema Validation', () => {
  it('should accept zero causes (optional)', () => {
    const result = causesSchema.safeParse({
      causeIds: [],
    });
    expect(result.success).toBe(true);
  });

  it('should accept any number of causes', () => {
    const result = causesSchema.safeParse({
      causeIds: ['1', '2', '3', '4'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept many causes', () => {
    const result = causesSchema.safeParse({
      causeIds: ['1', '2', '3', '4', '5', '6', '7'],
    });
    expect(result.success).toBe(true);
  });
});

describe('Full Onboarding Schema', () => {
  it('should validate complete onboarding data', () => {
    const result = onboardingSchema.safeParse({
      zipCode: '90210',
      streetAddress: '123 Main St',
      causeIds: ['1', '2', '3', '4'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept data with no causes (optional)', () => {
    const result = onboardingSchema.safeParse({
      zipCode: '90210',
      causeIds: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('CauseSelector Component', () => {
  it('should render all causes', () => {
    const onSelectionChange = vi.fn();
    render(<CauseSelector causes={mockCauses} selectedIds={[]} onSelectionChange={onSelectionChange} />);

    mockCauses.forEach((cause) => {
      expect(screen.getByText(cause.name)).toBeInTheDocument();
    });
  });

  it('should show selection count', () => {
    const onSelectionChange = vi.fn();
    render(
      <CauseSelector
        causes={mockCauses}
        selectedIds={['1', '2']}
        onSelectionChange={onSelectionChange}
        minRequired={0}
      />,
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('should call onSelectionChange when a cause is clicked', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(<CauseSelector causes={mockCauses} selectedIds={[]} onSelectionChange={onSelectionChange} />);

    await user.click(screen.getByText('Climate & Environment'));

    expect(onSelectionChange).toHaveBeenCalledWith(['1']);
  });

  it('should deselect a cause when clicked again', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(<CauseSelector causes={mockCauses} selectedIds={['1']} onSelectionChange={onSelectionChange} />);

    await user.click(screen.getByText('Climate & Environment'));

    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('should show sky text when causes are selected', () => {
    const onSelectionChange = vi.fn();
    render(
      <CauseSelector
        causes={mockCauses}
        selectedIds={['1', '2', '3', '4']}
        onSelectionChange={onSelectionChange}
        minRequired={0}
      />,
    );

    const countText = screen.getByText('4 selected');
    expect(countText).toHaveClass('text-sky-500');
  });
});
