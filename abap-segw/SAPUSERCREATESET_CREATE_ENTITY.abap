METHOD sapusercreateset_create_entity.
  DATA: ls_entity    TYPE zcl_zuser_lock_srv_mpc=>ts_sapusercreate,
        ls_address   TYPE bapiaddr3,
        ls_password  TYPE bapipwd,
        ls_logondata TYPE bapilogond,
        lt_return    TYPE TABLE OF bapiret2,
        ls_return    TYPE bapiret2.

  io_data_provider->read_entry_data(
    IMPORTING
      es_data = ls_entity ).

  ls_address-lastname = ls_entity-lastname.
  ls_logondata-ustyp  = 'A'.
  ls_password-bapipwd = ls_entity-password.

  CALL FUNCTION 'BAPI_USER_CREATE1'
    EXPORTING
      username  = ls_entity-username
      address   = ls_address
      password  = ls_password
      logondata = ls_logondata
    TABLES
      return    = lt_return.

  READ TABLE lt_return INTO ls_return WITH KEY type = 'E'.
  IF sy-subrc = 0.
    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    ls_entity-message = ls_return-message.
  ELSE.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = abap_true.
    ls_entity-message = 'User created successfully'.
  ENDIF.

  er_entity = ls_entity.
ENDMETHOD.
