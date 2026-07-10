# CerberuS - ABAP/SEGW Backend Methods

This folder contains the ABAP method redefinitions for the SEGW OData service
`ZUSER_LOCK_SRV` (class `ZCL_ZUSER_LOCK_SRV_DPC_EXT`), used by the CerberuS
SAP Security AI tool to connect to a live SAP S/4HANA system.

**Note:** These are system-specific redefinitions. Regenerating SEGW Runtime
Objects wipes these out — they must be manually re-applied after regeneration
(particularly `SAPUSERCREATESET_CREATE_ENTITY`).

## Methods

| File | Purpose |
|---|---|
| `USERLOCKSET_GET_ENTITYSET.abap` | Reads USR02 table, returns all users with locked/unlocked status |
| `DEVACCESSUSERSET_GET_ENTITYSET.abap` | Reads AGR_1251/AGR_USERS for S_DEVELOP object (ACTVT 01/02), returns users with dev access roles |
| `SAPUSERCREATESET_CREATE_ENTITY.abap` | Creates a new SAP user via BAPI_USER_CREATE1 (username, lastName, password) |
| `ROLEASSIGN_CREATE_ENTITY.abap` | Assigns a role to an existing user via BAPI_USER_ACTGROUPS_ASSIGN, preserving existing role assignments |

## Registration reminder
After regenerating SEGW runtime objects, don't forget to re-register the
service in `/IWFND/MAINT_SERVICE` with System Alias LOCAL if needed.
