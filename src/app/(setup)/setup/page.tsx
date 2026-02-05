import { OnboardingWizard } from '@/components/onboarding';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';

export const metadata = {
  title: 'Our Power | Setup Profile',
};

export default function Page() {
  return (
    <ResponsiveContainer className="mx-auto my-4 px-4 md:px-0">
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-bold">Welcome to Our Power!</h1>
        <p className="text-muted-foreground">Let's get you set up to start making a difference.</p>
      </div>
      <OnboardingWizard />
    </ResponsiveContainer>
  );
}
