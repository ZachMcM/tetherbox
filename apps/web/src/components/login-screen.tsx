import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@tetherbox/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tetherbox/ui/components/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { loginWithToken, queryKeys } from "../lib/api.ts";

export function LoginScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [token, setToken] = useState("");

  const mutation = useMutation({
    mutationFn: loginWithToken,
    onSuccess: async () => {
      setToken("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth });
      await router.invalidate();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const trimmed = token.trim();

    if (trimmed !== "") {
      mutation.mutate(trimmed);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Tetherbox</CardTitle>
          <CardDescription>Enter the daemon app token to unlock this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field>
              <FieldLabel htmlFor="app-token">App token</FieldLabel>
              <Input
                id="app-token"
                type="password"
                autoComplete="current-password"
                placeholder="Paste token from tetherbox-daemon app-token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
              <FieldDescription>
                Locally in dev, read <code>.local/data/app-token</code>. On a VM, run{" "}
                <code>tetherbox-daemon app-token</code>.
              </FieldDescription>
            </Field>
            {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending || token.trim() === ""}
            >
              {mutation.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
