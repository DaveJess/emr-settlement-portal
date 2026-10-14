import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useApp } from "../hooks/useApp";
import type { User } from "../types";

interface CashierForm {
  name: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
  hospitalId: string;
}

export default function CashiersPage() {
  const { data, currentUser, createCashier: createCashierApi, setUserStatus, setUserFacilities } = useApp();

  const [search, setSearch] = useState("");
  const [hospitalFilter, setHospitalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [assignmentCashierId, setAssignmentCashierId] =
    useState<string | null>(null);

  const [assignmentHospitalId, setAssignmentHospitalId] =
    useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [form, setForm] = useState<CashierForm>({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    hospitalId: "",
  });

  if (!currentUser || currentUser.role === "cashier") {
    return null;
  }

  const actor = currentUser;
  const isFinance = actor.role === "finance";

  const availableHospitals = data.hospitals.filter(
    (hospital) =>
      actor.hospitalIds.includes(hospital.id),
  );

  const visibleCashiers = data.users.filter(
    (user) =>
      user.role === "cashier" &&
      user.hospitalIds.some((hospitalId) =>
        actor.hospitalIds.includes(hospitalId),
      ),
  );

  const filteredCashiers = visibleCashiers.filter(
    (cashier) => {
      const matchesSearch = cashier.name
        .toLowerCase()
        .includes(search.trim().toLowerCase());

      const matchesHospital =
        !hospitalFilter ||
        cashier.hospitalIds.includes(hospitalFilter);

      const matchesStatus =
        !statusFilter || cashier.status === statusFilter;

      return (
        matchesSearch &&
        matchesHospital &&
        matchesStatus
      );
    },
  );

  const assignmentCashier = data.users.find(
    (user) => user.id === assignmentCashierId,
  );

  function hospitalName(id: string): string {
    return (
      data.hospitals.find(
        (hospital) => hospital.id === id,
      )?.name ?? "Unknown hospital"
    );
  }

  function openCreateForm() {
    setError("");
    setMessage("");

    setForm({
      name: "",
      phone: "",
      email: "",
      password: "",
      confirmPassword: "",
      hospitalId: availableHospitals[0]?.id ?? "",
    });

    setShowCreateForm(true);
  }

  async function createCashier() {
    setError("");
    setMessage("");

    if (!isFinance) {
      setError("Only Finance can create cashier accounts.");
      return;
    }

    const name = form.name.trim();
    const phone = form.phone.trim();
    const email = form.email.trim().toLowerCase();

    if (!name || !phone || !email || !form.hospitalId) {
      setError("Complete all required fields.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    if (!/^\+?[\d\s()-]{7,20}$/.test(phone)) {
      setError("Enter a valid phone number.");
      return;
    }

    if (form.password.length < 12 || form.password.length > 128) {
      setError("Password must contain 12 to 128 characters.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (
      !availableHospitals.some(
        (hospital) => hospital.id === form.hospitalId,
      )
    ) {
      setError("Select a hospital under your supervision.");
      return;
    }

    try {
      const cashier = await createCashierApi({ name, phone, email, password: form.password, facilityIds: [form.hospitalId] });

      setShowCreateForm(false);
      setMessage(
        `Account created for ${cashier.name}. Provide the cashier with their email and password.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create the account.",
      );
    }
  }

  async function changeAccountStatus(cashier: User) {
    setError("");
    setMessage("");

    if (!isFinance) {
      setError("Only Finance can change account status.");
      return;
    }

    const nextStatus =
      cashier.status === "active"
        ? "inactive"
        : "active";

    const action =
      nextStatus === "inactive"
        ? "Deactivate"
        : "Reactivate";

    if (
      !window.confirm(
        `${action} ${cashier.name}'s account? Existing accounting records will be retained.`,
      )
    ) {
      return;
    }

    try {
      await setUserStatus(cashier.id, nextStatus);

      setMessage(
        `${cashier.name}'s account is now ${nextStatus}.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update account status.",
      );
    }
  }

  function openAssignment(cashier: User) {
    setError("");
    setMessage("");
    setAssignmentCashierId(cashier.id);
    setAssignmentHospitalId(cashier.hospitalIds[0] ?? "");
  }

  async function saveAssignment() {
    setError("");
    setMessage("");

    if (!isFinance || !assignmentCashierId) {
      setError("Only Finance can assign cashier accounts.");
      return;
    }

    if (
      !availableHospitals.some(
        (hospital) =>
          hospital.id === assignmentHospitalId,
      )
    ) {
      setError("Select a hospital under your supervision.");
      return;
    }

    try {
      await setUserFacilities(assignmentCashierId, [assignmentHospitalId]);

      setAssignmentCashierId(null);
      setMessage("Cashier hospital assignment updated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update hospital assignment.",
      );
    }
  }

  const inputClass =
    "w-full rounded-lg border border-lunar-border bg-white px-3 py-2.5 text-sm";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Cashiers
          </h1>

          <p className="mt-2 text-sm text-lunar-muted">
            {isFinance
              ? "Create and manage cashier accounts within your assigned hospitals."
              : "View cashiers assigned to your hospital."}
          </p>
        </div>

        {isFinance && (
          <button
            type="button"
            onClick={openCreateForm}
            disabled={availableHospitals.length === 0}
            className="flex items-center gap-2 rounded-lg bg-lunar-primary px-4 py-3 text-sm font-medium text-white hover:bg-lunar-primary-dark disabled:opacity-50"
          >
            <Plus size={18} />
            Add cashier
          </button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          {message}
        </p>
      )}

      {error && !showCreateForm && !assignmentCashierId && (
        <p
          role="alert"
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <section className="mt-6 overflow-hidden rounded-xl border border-lunar-border bg-white">
        <div className="flex flex-wrap gap-3 border-b border-lunar-border p-4">
          <div className="relative min-w-48 flex-1">
            <Search
              size={17}
              className="absolute left-3 top-3 text-lunar-muted"
            />

            <input
              aria-label="Search cashier name"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search cashier name"
              className={`${inputClass} pl-10`}
            />
          </div>

          <select
            aria-label="Filter hospital"
            value={hospitalFilter}
            onChange={(event) =>
              setHospitalFilter(event.target.value)
            }
            className="rounded-lg border border-lunar-border px-3 py-2 text-sm"
          >
            <option value="">All assigned hospitals</option>

            {availableHospitals.map((hospital) => (
              <option
                key={hospital.id}
                value={hospital.id}
              >
                {hospital.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter account status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
            className="rounded-lg border border-lunar-border px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-lunar-background text-xs text-lunar-muted">
              <tr>
                <th className="px-5 py-4">Name</th>
                <th className="px-5 py-4">Contact</th>
                <th className="px-5 py-4">Hospital</th>
                <th className="px-5 py-4">Status</th>
                {isFinance && (
                  <th className="px-5 py-4">Actions</th>
                )}
              </tr>
            </thead>

            <tbody>
              {filteredCashiers.map((cashier) => (
                <tr
                  key={cashier.id}
                  className="border-t border-lunar-border"
                >
                  <td className="whitespace-nowrap px-5 py-4 font-medium">
                    {cashier.name}
                  </td>

                  <td className="px-5 py-4">
                    <p>{cashier.email}</p>
                    <p className="mt-1 text-xs text-lunar-muted">
                      {cashier.phone}
                    </p>
                  </td>

                  <td className="px-5 py-4">
                    {cashier.hospitalIds
                      .map(hospitalName)
                      .join(", ")}
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={
                        cashier.status === "active"
                          ? "rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
                          : "rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600"
                      }
                    >
                      {cashier.status}
                    </span>
                  </td>

                  {isFinance && (
                    <td className="px-5 py-4">
                      <div className="flex gap-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            openAssignment(cashier)
                          }
                          className="text-xs font-medium text-lunar-primary"
                        >
                          Change hospital
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            changeAccountStatus(cashier)
                          }
                          className="text-xs font-medium text-lunar-primary"
                        >
                          {cashier.status === "active"
                            ? "Deactivate"
                            : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {filteredCashiers.length === 0 && (
            <p className="p-8 text-center text-sm text-lunar-muted">
              No cashiers match your filters.
            </p>
          )}
        </div>
      </section>

      {showCreateForm && isFinance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-cashier-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <h2
                id="create-cashier-title"
                className="text-xl font-semibold"
              >
                Create cashier account
              </h2>

              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowCreateForm(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createCashier();
              }}
            >
              <label className="block text-sm">
                Full name
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      name: event.target.value,
                    })
                  }
                  className={`${inputClass} mt-2`}
                />
              </label>

              <label className="block text-sm">
                Phone number
                <input
                  required
                  type="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      phone: event.target.value,
                    })
                  }
                  className={`${inputClass} mt-2`}
                />
              </label>

              <label className="block text-sm">
                Email address
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      email: event.target.value,
                    })
                  }
                  className={`${inputClass} mt-2`}
                />
              </label>

              <label className="block text-sm">
                Hospital
                <select
                  required
                  value={form.hospitalId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      hospitalId: event.target.value,
                    })
                  }
                  className={`${inputClass} mt-2`}
                >
                  <option value="">Select hospital</option>

                  {availableHospitals.map((hospital) => (
                    <option
                      key={hospital.id}
                      value={hospital.id}
                    >
                      {hospital.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                Password
                <input
                  required
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      password: event.target.value,
                    })
                  }
                  className={`${inputClass} mt-2`}
                />
              </label>

              <label className="block text-sm">
                Confirm password
                <input
                  required
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      confirmPassword: event.target.value,
                    })
                  }
                  className={`${inputClass} mt-2`}
                />
              </label>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setShowCreateForm(false)
                  }
                  className="rounded-lg border border-lunar-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="rounded-lg bg-lunar-primary px-4 py-2 text-sm font-medium text-white"
                >
                  Create account
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {assignmentCashier && isFinance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-cashier-title"
            className="w-full max-w-md rounded-xl bg-white p-6"
          >
            <h2
              id="assign-cashier-title"
              className="text-xl font-semibold"
            >
              Change hospital
            </h2>

            <p className="mt-2 text-sm text-lunar-muted">
              {assignmentCashier.name}
            </p>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveAssignment();
              }}
            >
              <label className="block text-sm">
                Hospital
                <select
                  required
                  value={assignmentHospitalId}
                  onChange={(event) =>
                    setAssignmentHospitalId(
                      event.target.value,
                    )
                  }
                  className={`${inputClass} mt-2`}
                >
                  <option value="">Select hospital</option>

                  {availableHospitals.map((hospital) => (
                    <option
                      key={hospital.id}
                      value={hospital.id}
                    >
                      {hospital.name}
                    </option>
                  ))}
                </select>
              </label>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setAssignmentCashierId(null)
                  }
                  className="rounded-lg border border-lunar-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="rounded-lg bg-lunar-primary px-4 py-2 text-sm text-white"
                >
                  Save assignment
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
