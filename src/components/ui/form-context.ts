import { createContext } from "react";

/** Errores por campo de la última respuesta de la acción; `Field`/`SelectField` los leen por `name`. */
export const FormErrorsContext = createContext<Record<string, string[]> | undefined>(undefined);
