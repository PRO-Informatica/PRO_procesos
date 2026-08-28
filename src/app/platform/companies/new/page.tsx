import { MotionPage } from "@/components/motion/motion-page";
import { CreateCompanyForm } from "@/features/platform/companies/components/create-company-form";

export default function NewCompanyPage() {
  return (
    <MotionPage className="mx-auto max-w-2xl">
      <CreateCompanyForm />
    </MotionPage>
  );
}
