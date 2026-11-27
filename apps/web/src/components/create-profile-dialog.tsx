import { Button } from "@tetherbox/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tetherbox/ui/components/dialog";
import { CreateProfileForm } from "./create-profile-form.tsx";

export function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (profileId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <CreateProfileForm
          idPrefix="create-profile"
          title="New profile"
          secondaryAction={
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          renderHeader={({ title, description }) => (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          )}
          renderFooter={(actions) => <DialogFooter>{actions}</DialogFooter>}
          onCreated={(profileId) => {
            onOpenChange(false);
            onCreated(profileId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
