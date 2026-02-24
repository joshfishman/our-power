import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CreateActionForm } from '@/components/campaigns/CreateActionForm';

/**
 * Mock the Select component as a native HTML select so we can interact with it
 * in jsdom. React.Children.toArray gives us access to the Item keys via the
 * '.$<key>' prefix React adds to the key.
 */
vi.mock('@/components/ui/Select', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Select: ({ label, selectedKey, onSelectionChange, children }: any) => {
    const options = React.Children.toArray(children).map(
      (child: React.ReactElement<{ children?: React.ReactNode }>) => ({
        value: child.key?.replace(/^\.\$/, '') || '',
        text: child.props?.children ?? '',
      }),
    );
    return (
      <select
        aria-label={label}
        value={selectedKey || ''}
        onChange={(e) => onSelectionChange?.(e.target.value)}
        data-testid={`select-${(label ?? '').toLowerCase().replace(/\s+/g, '-')}`}>
        {options.map(({ value, text }) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    );
  },
}));

/** Mock DatePicker as a simple date input to avoid react-aria calendar complexity */
vi.mock('@/components/ui/DatePicker', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DatePicker: ({ label, value, onChange }: any) => (
    <input
      type="date"
      aria-label={label}
      data-testid="date-picker"
      value={value ? value.toString() : ''}
      onChange={(e) => {
        if (onChange && e.target.value) {
          onChange({ toString: () => e.target.value });
        } else if (onChange) {
          onChange(null);
        }
      }}
    />
  ),
}));

/** Avoid Next.js image optimization in tests */
vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...rest} />
  ),
}));

/** Avoid ToastContext dependency */
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

function createWrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Shared initial action used across tests (EVENT type, date set) */
const baseInitialAction = {
  title: 'Test Action Title',
  description: 'Test description text',
  type: 'EVENT' as const,
  dueDate: '2026-06-01T23:59:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: [] }), { status: 200 })));
});

// ─────────────────────────────────────────────
// Basic rendering
// ─────────────────────────────────────────────
describe('CreateActionForm — rendering', () => {
  it('renders the title field', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Title *')).toBeInTheDocument();
  });

  it('renders the description field', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('renders the action type selector', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByTestId('select-action-type')).toBeInTheDocument();
  });

  it('renders the date picker', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByTestId('date-picker')).toBeInTheDocument();
  });

  it('renders "Create Action" submit button in create mode', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Create Action')).toBeInTheDocument();
  });

  it('renders "Update Action" submit button in edit mode', () => {
    render(
      <CreateActionForm campaignId="campaign-1" mode="edit" actionId="action-1" initialAction={baseInitialAction} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByText('Update Action')).toBeInTheDocument();
  });

  it('shows a Cancel button when onCancel prop is provided', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────
// Type-specific field rendering
// ─────────────────────────────────────────────
describe('CreateActionForm — type-specific field rendering', () => {
  it('shows location fields for EVENT type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Location URL (optional)')).toBeInTheDocument();
  });

  it('shows due time field for all types (not type-specific)', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Due Time (optional)')).toBeInTheDocument();
  });

  it('shows email subject and email body for EMAIL type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EMAIL' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Email Subject')).toBeInTheDocument();
    expect(screen.getByText('Email Body')).toBeInTheDocument();
  });

  it('shows call script for PHONE type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'PHONE' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Call Script')).toBeInTheDocument();
  });

  it('shows canvass area for CANVASS type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'CANVASS' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Canvass Area')).toBeInTheDocument();
  });

  it('does not show email fields for EVENT type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.queryByText('Email Subject')).not.toBeInTheDocument();
    expect(screen.queryByText('Email Body')).not.toBeInTheDocument();
  });

  it('does not show call script for EMAIL type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EMAIL' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.queryByText('Call Script')).not.toBeInTheDocument();
  });

  it('shows support targeting section for EMAIL type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EMAIL' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Support Targeting')).toBeInTheDocument();
  });

  it('shows support targeting section for PHONE type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'PHONE' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Support Targeting')).toBeInTheDocument();
  });

  it('does not show support targeting for EVENT type', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });
    expect(screen.queryByText('Support Targeting')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────
// Type switching via the Select component
// ─────────────────────────────────────────────
describe('CreateActionForm — type switching', () => {
  it('switches to EMAIL fields when type is changed to EMAIL', async () => {
    const user = userEvent.setup();
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });

    const typeSelect = screen.getByTestId('select-action-type');
    await user.selectOptions(typeSelect, 'EMAIL');

    expect(screen.getByText('Email Subject')).toBeInTheDocument();
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
  });

  it('switches to PHONE fields when type is changed to PHONE', async () => {
    const user = userEvent.setup();
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });

    const typeSelect = screen.getByTestId('select-action-type');
    await user.selectOptions(typeSelect, 'PHONE');

    expect(screen.getByText('Call Script')).toBeInTheDocument();
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
  });

  it('switches to CANVASS fields when type is changed to CANVASS', async () => {
    const user = userEvent.setup();
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />, {
      wrapper: createWrapper(),
    });

    const typeSelect = screen.getByTestId('select-action-type');
    await user.selectOptions(typeSelect, 'CANVASS');

    expect(screen.getByText('Canvass Area')).toBeInTheDocument();
    expect(screen.queryByText('Email Subject')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────
// Submit behavior
// ─────────────────────────────────────────────
describe('CreateActionForm — submit behavior', () => {
  it('submit button is disabled when title is empty', () => {
    render(<CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, title: '' }} />, {
      wrapper: createWrapper(),
    });
    const submitBtn = screen.getByText('Create Action');
    expect(submitBtn).toBeDisabled();
  });

  it('calls POST /api/actions in create mode on form submit', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-action', title: 'Test' }), { status: 201 }));

    const { container } = render(
      <CreateActionForm campaignId="campaign-1" initialAction={{ ...baseInitialAction, type: 'EVENT' }} />,
      { wrapper: createWrapper() },
    );

    // Submit the form directly to bypass react-aria button interaction quirks
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      const postCalls = mockFetch.mock.calls.filter(
        ([url, opts]) => url === '/api/actions' && (opts as RequestInit)?.method === 'POST',
      );
      expect(postCalls.length).toBeGreaterThan(0);
    });
  });

  it('calls PATCH /api/actions/[id] in edit mode on form submit', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'action-1', title: 'Updated' }), { status: 200 }),
    );

    const { container } = render(
      <CreateActionForm
        campaignId="campaign-1"
        mode="edit"
        actionId="action-1"
        initialAction={{ ...baseInitialAction, type: 'EVENT' }}
      />,
      { wrapper: createWrapper() },
    );

    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      const patchCalls = mockFetch.mock.calls.filter(
        ([url, opts]) => url === '/api/actions/action-1' && (opts as RequestInit)?.method === 'PATCH',
      );
      expect(patchCalls.length).toBeGreaterThan(0);
    });
  });

  it('calls onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<CreateActionForm campaignId="campaign-1" initialAction={baseInitialAction} onCancel={onCancel} />, {
      wrapper: createWrapper(),
    });

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
