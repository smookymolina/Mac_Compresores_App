-- Paquetes de complementos y garantía por cotización
ALTER TABLE "Quote" ADD COLUMN "complements" JSONB, ADD COLUMN "warrantyMonths" INTEGER;

CREATE TABLE "ComplementPackage" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activities" TEXT[],
    "warrantyMonths" INTEGER NOT NULL DEFAULT 3,
    "skuPatterns" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplementPackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComplementPackage_code_key" ON "ComplementPackage"("code");

-- Paquetes iniciales tomados de las cotizaciones reales (editables en Productos › Complementos)
INSERT INTO "ComplementPackage" ("id","code","name","activities","warrantyMonths","skuPatterns","position","updatedAt") VALUES
(gen_random_uuid(),'SERV-01','Servicio a domicilio',ARRAY['Servicio a domicilio','Cambio de filtros','Toma de amperaje','Ajuste eléctrico','Ajuste neumático','Ajuste de presión','Revisión de acople','Revisión general del motor','Reseteo de alarmas','Purga de tanque','Limpieza general de la unidad','Limpieza general del radiador','Reporte de servicio']::TEXT[],3,ARRAY['SERV-01*','SRV-MANT-*']::TEXT[],0,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-PISTON','Servicio preventivo a compresor de pistón',ARRAY['Desenergizado de corriente eléctrica','Bloqueo de la descarga a la red neumática','Candadeo (LOTO) si es posible','Retiro de filtro de aire','Drenado de lubricante','Limpieza general','Limpieza de switch de presión','Limpieza de arrancador, si es el caso','Inspección del estado de la banda o bandas de transmisión de potencia','Sustitución de bandas, de ser el caso','Tensión de bandas','Instalación de filtro de aire','Llenado de lubricante','Reengrase de rodamientos del motor eléctrico, si este lo permite','Purga de tanque de almacenamiento','Retiro de candadeo (LOTO)','Energizado de compresor','Arranque de compresor','Inspección de válvula antirretorno','Pruebas de funcionamiento']::TEXT[],3,ARRAY['SERV-*-PI*','SERV-PISTON*','SERV*PIST*','SERV-DW*','KIT-OVRH-*PI','Servicio*pist*n*']::TEXT[],1,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-4000','Servicio de 4000 horas (tornillo)',ARRAY['Sustitución del filtro de aire','Sustitución del filtro de aceite','Sustitución del separador (según indicaciones del fabricante)','Mantenimiento a control eléctrico','Reapriete de conexiones eléctricas','Reapriete de conexiones neumáticas','Inspección visual del estado de las mangueras','Lavado a presión del enfriador','Inspección del nivel de aceite','Medición de parámetros eléctricos','Limpieza general','Reporte de servicio del estado determinado en las inspecciones','Reporte termográfico','Engrasado de rodamientos / motor (si el motor lo permite)','Sustitución de lubricante o relleno (dependiendo del tipo)','Alineación, tensión e inspección de bandas (transmisión por bandas)','Alineación de motor y unidad de compresor (transmisión directa)','Inspección de poleas','Reporte general']::TEXT[],3,ARRAY['4000-*','*-4000HRS*']::TEXT[],2,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-8000','Servicio de 8000 horas (tornillo)',ARRAY['Sustitución del filtro de aire','Sustitución del filtro de aceite','Sustitución del separador (según indicaciones del fabricante)','Mantenimiento a control eléctrico','Reapriete de conexiones eléctricas','Reapriete de conexiones neumáticas','Inspección visual del estado de las mangueras','Lavado a presión del enfriador','Inspección del nivel de aceite','Medición de parámetros eléctricos','Limpieza general','Reporte de servicio del estado determinado en las inspecciones','Reporte termográfico','Engrasado de rodamientos / motor (si el motor lo permite)','Sustitución de lubricante','Alineación, tensión e inspección de bandas (transmisión por bandas)','Alineación de motor y unidad de compresor (transmisión directa)','Inspección de poleas','Reporte general']::TEXT[],3,ARRAY['8000-*','*-8000HRS*','Servicio de 8000 h*']::TEXT[],3,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-COMPRESOR','Equipo nuevo',ARRAY[]::TEXT[],12,ARRAY['CML*','SC-*','CSC-*','Compresor *','Motocompresor *']::TEXT[],4,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-RENTA','Renta de equipo',ARRAY[]::TEXT[],1,ARRAY['RM*','RQ*','RENT-*','SRV-RENTA*','Renta *']::TEXT[],5,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-REFACCIONAMIENTO','Refacciones',ARRAY[]::TEXT[],1,ARRAY['K-*','KIT-*','Kit de *']::TEXT[],6,CURRENT_TIMESTAMP),
(gen_random_uuid(),'SERV-MANGUERA','Venta e instalación de mangueras',ARRAY[]::TEXT[],3,ARRAY['MANG-*','MAGN-*','INST-MANG*','Manguera *']::TEXT[],7,CURRENT_TIMESTAMP);
