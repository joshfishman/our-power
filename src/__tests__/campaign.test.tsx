import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { campaignSchema, actionSchema } from '@/lib/validations/campaign';
import { CampaignCard } from '@/components/campaigns/CampaignCard';
import { ActionCard } from '@/components/campaigns/ActionCard';

// Mock campaign data
const mockCampaign = {
  id: 'campaign-1',
  name: 'Climate Action Now',
  description: 'A campaign to push for climate legislation in California.',
  type: 'LEGISLATIVE',
  status: 'ACTIVE',
  imageUrl: null,
  cause: {
    id: 'cause-1',
    name: 'Climate & Environment',
    icon: '🌍',
    color: '#22c55e',
  },
  org: {
    id: 'org-1',
    name: 'Green Future Coalition',
    logoUrl: null,
  },
  _count: {
    members: 150,
    actions: 5,
  },
};

// Mock action data
const mockAction = {
  id: 'action-1',
  title: 'Call Your Representative',
  description: 'Make calls to push for the climate bill.',
  type: 'PHONE' as const,
  dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
  location: null,
  eventTime: null,
  callScript: 'Hello, I am calling to urge support for...',
  dialerUrl: 'https://scaletowin.com/campaign/123',
  _count: { participants: 45 },
  participants: [],
};

describe('Campaign Schema Validation', () => {
  it('should validate a valid campaign', () => {
    const result = campaignSchema.safeParse({
      name: 'Test Campaign',
      description: 'This is a test campaign description.',
      type: 'LEGISLATIVE',
      causeId: 'cause-1',
      orgId: 'org-1',
    });
    expect(result.success).toBe(true);
  });

  it('should reject a campaign with short name', () => {
    const result = campaignSchema.safeParse({
      name: 'Hi',
      description: 'This is a test campaign description.',
      type: 'LEGISLATIVE',
      causeId: 'cause-1',
      orgId: 'org-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a campaign with short description', () => {
    const result = campaignSchema.safeParse({
      name: 'Test Campaign',
      description: 'Short',
      type: 'LEGISLATIVE',
      causeId: 'cause-1',
      orgId: 'org-1',
    });
    expect(result.success).toBe(false);
  });

  it('should validate all campaign types', () => {
    const types = ['LEGISLATIVE', 'FISCAL', 'CRIMINAL_JUSTICE', 'ELECTORAL', 'COMMUNITY', 'OTHER'];
    types.forEach((type) => {
      const result = campaignSchema.safeParse({
        name: 'Test Campaign',
        description: 'This is a test campaign description.',
        type,
        causeId: 'cause-1',
        orgId: 'org-1',
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Action Schema Validation', () => {
  it('should validate a valid EVENT action', () => {
    const result = actionSchema.safeParse({
      title: 'Town Hall Meeting',
      description: 'Join us for a town hall meeting.',
      type: 'EVENT',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      location: '123 Main St',
      eventTime: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('should validate a valid PHONE action', () => {
    const result = actionSchema.safeParse({
      title: 'Phone Bank',
      type: 'PHONE',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      callScript: 'Hello, I am calling about...',
      phoneNumbers: ['555-1234', '555-5678'],
    });
    expect(result.success).toBe(true);
  });

  it('should validate a valid EMAIL action', () => {
    const result = actionSchema.safeParse({
      title: 'Email Campaign',
      type: 'EMAIL',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      emailSubject: 'Support the Climate Bill',
      emailBody: 'Dear Representative...',
      emailTargets: ['rep@gov.example.com'],
    });
    expect(result.success).toBe(true);
  });

  it('should validate a valid CANVASS action', () => {
    const result = actionSchema.safeParse({
      title: 'Door Knocking',
      type: 'CANVASS',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      canvassArea: 'Downtown District',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an action with short title', () => {
    const result = actionSchema.safeParse({
      title: 'Hi',
      type: 'EVENT',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('CampaignCard Component', () => {
  it('should render campaign name', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('Climate Action Now')).toBeInTheDocument();
  });

  it('should render cause name with icon', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('Climate & Environment')).toBeInTheDocument();
  });

  it('should render organization name', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('Green Future Coalition')).toBeInTheDocument();
  });

  it('should render member count', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('150 members')).toBeInTheDocument();
  });

  it('should render action count', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('5 actions')).toBeInTheDocument();
  });

  it('should link to campaign detail page', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/campaigns/campaign-1');
  });
});

describe('ActionCard Component', () => {
  it('should render action title', () => {
    render(<ActionCard action={mockAction} />);
    expect(screen.getByText('Call Your Representative')).toBeInTheDocument();
  });

  it('should render action type label', () => {
    render(<ActionCard action={mockAction} />);
    expect(screen.getByText('Phone Bank')).toBeInTheDocument();
  });

  it('should render participant count', () => {
    render(<ActionCard action={mockAction} />);
    expect(screen.getByText('45 participants')).toBeInTheDocument();
  });

  it('should show Tomorrow for tomorrow actions', () => {
    render(<ActionCard action={mockAction} />);
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
  });

  it('should show RSVP button when not RSVPd', () => {
    const onRSVP = vi.fn();
    render(<ActionCard action={mockAction} onRSVP={onRSVP} />);
    expect(screen.getByText("I'll do this")).toBeInTheDocument();
  });

  it('should show Open Dialer button for phone actions with dialerUrl', () => {
    render(<ActionCard action={mockAction} />);
    expect(screen.getByText('Open Dialer')).toBeInTheDocument();
  });

  it('should call onRSVP when RSVP button is clicked', async () => {
    const user = userEvent.setup();
    const onRSVP = vi.fn();
    render(<ActionCard action={mockAction} onRSVP={onRSVP} />);

    await user.click(screen.getByText("I'll do this"));
    expect(onRSVP).toHaveBeenCalledWith('action-1');
  });

  it('should show Mark Complete button when RSVPd', () => {
    const onComplete = vi.fn();
    const rsvpdAction = {
      ...mockAction,
      participants: [{ willAttend: true, attended: false }],
    };
    render(<ActionCard action={rsvpdAction} onComplete={onComplete} />);
    expect(screen.getByText('Mark Complete')).toBeInTheDocument();
  });

  it('should show Completed badge when action is completed', () => {
    const completedAction = {
      ...mockAction,
      participants: [{ willAttend: true, attended: true }],
    };
    render(<ActionCard action={completedAction} />);
    expect(screen.getByText('✓ Completed')).toBeInTheDocument();
  });
});
